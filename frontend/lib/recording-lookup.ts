/**
 * One place that answers "which 3CX recording belongs to this call / request?".
 * Used by HR approve + retry, agent auto-approve, and the agent download button,
 * so every path follows the same rules (and the same HR-editable settings).
 */
import { query, queryOne } from '@/lib/db';
import {
  searchRecordingsByPhone,
  assignRecordingsToCalls,
  latestRecordingForPhone,
  type MatchOptions,
  type ThreeCXRecording,
} from '@/lib/3cx-client';
import { getRecordingSettings } from '@/lib/recording-settings';

export interface LookupResult {
  recId: string | null;
  /** Set when 3CX could not be asked — the recording may still exist, so retry later. */
  error?: string;
}

export interface CallLogRow {
  id: number;
  phone_number: string | null;
  agent_extension: string | null;
  call_time: string | Date;
  rec_id: string | null;
}

export async function getClientSecret(): Promise<string | null> {
  return (await queryOne<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = 'recording_access_token'`
  ))?.value || null;
}

export async function matchOptions(): Promise<MatchOptions> {
  const s = await getRecordingSettings();
  return { minSeconds: s.recordingMinSeconds, windowMs: s.matchWindowMinutes * 60 * 1000 };
}

/**
 * Every logged call to the same numbers around the given calls — including short
 * ones that never show up in audits — so they can claim their own recordings
 * before a neighbouring call borrows one.
 */
export async function loadSiblingCalls(calls: CallLogRow[], padMs: number): Promise<CallLogRow[]> {
  const phones = Array.from(new Set(calls.map(c => (c.phone_number || '').replace(/\D/g, '').slice(-10)).filter(p => p.length >= 7)));
  if (!phones.length) return calls;
  const times = calls.map(c => new Date(c.call_time).getTime());
  const rows = await query<CallLogRow>(
    `SELECT id, phone_number, agent_extension, call_time, rec_id
     FROM call_logs
     WHERE call_time BETWEEN $1 AND $2
       AND right(regexp_replace(phone_number, '\\D', '', 'g'), 10) = ANY($3)`,
    [new Date(Math.min(...times) - padMs).toISOString(), new Date(Math.max(...times) + padMs).toISOString(), phones]
  );
  const seen = new Set(rows.map(r => String(r.id)));
  return [...rows, ...calls.filter(c => !seen.has(String(c.id)))];
}

/** Pair the given calls with recordings, letting neighbouring calls compete fairly. */
export async function assignForCalls(calls: CallLogRow[], recordings: ThreeCXRecording[], opts: MatchOptions) {
  const siblings = await loadSiblingCalls(calls, opts.windowMs + 3600 * 1000);
  return assignRecordingsToCalls(recordings, siblings, opts);
}

/** Find (and cache on call_logs) the recording for one logged call. */
export async function findRecordingForCallLog(callLog: CallLogRow, clientSecret: string, opts?: MatchOptions): Promise<LookupResult> {
  if (!callLog.phone_number) return { recId: null };
  const o = opts || await matchOptions();
  const callEnd = new Date(callLog.call_time).getTime();
  const { recordings, error } = await searchRecordingsByPhone(
    clientSecret,
    callLog.phone_number,
    new Date(callEnd - 24 * 3600 * 1000).toISOString(),
    new Date(callEnd + o.windowMs + 3600 * 1000).toISOString()
  );
  if (error) return { recId: null, error };

  const assigned = await assignForCalls([callLog], recordings, o);
  const match = assigned.get(String(callLog.id));
  const recId = match ? String(match.recording.Id) : null;
  if (recId !== (callLog.rec_id || null)) {
    await query(`UPDATE call_logs SET rec_id = $1 WHERE id = $2`, [recId, callLog.id]);
  }
  return { recId };
}

/** Find the recording for a recording request (tied to a call, or just a phone number). */
export async function findRecordingForRequest(
  rr: { phone_number: string; call_log_id: number | string | null },
  clientSecret: string
): Promise<LookupResult> {
  const o = await matchOptions();
  if (rr.call_log_id) {
    const callLog = await queryOne<CallLogRow>(
      `SELECT id, phone_number, agent_extension, call_time, rec_id FROM call_logs WHERE id = $1`,
      [rr.call_log_id]
    );
    if (callLog) return findRecordingForCallLog(callLog, clientSecret, o);
  }
  // No specific call picked: newest recording for this number in the last 7 days.
  const now = Date.now();
  const { recordings, error } = await searchRecordingsByPhone(
    clientSecret, rr.phone_number, new Date(now - 7 * 24 * 3600 * 1000).toISOString(), new Date(now + 3600 * 1000).toISOString()
  );
  if (error) return { recId: null, error };
  const latest = latestRecordingForPhone(recordings, rr.phone_number, o.minSeconds);
  return { recId: latest ? String(latest.Id) : null };
}
