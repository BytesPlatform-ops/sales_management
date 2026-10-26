/**
 * Calls + 3CX recordings for one shift, for one or many agents. Shared by the
 * per-agent call viewer (/hr/agents/[id]/calls) and Recordings by Agent.
 *
 * - Shift window and recording-match rules come from the recording settings,
 *   same as Call Auditing.
 * - Only calls longer than `minSeconds` are returned (default 60).
 * - Calls before an agent's start date are dropped (reused extensions).
 * - Recordings are matched once for all agents (one 3CX listing) and cached on
 *   call_logs.rec_id; QA transcript/score attached when available.
 */
import { query } from './db';
import { listRecordings } from './3cx-client';
import { assignForCalls, getClientSecret } from './recording-lookup';
import { getRecordingSettings, shiftWindowPKT } from './recording-settings';
import { recordingPlayUrl } from './recording-links';
import { getAgentStartDates } from './agent-start';

// call_duration is "MM:SS" or "HH:MM:SS"
export const DURATION_SEC_SQL = `(CASE
  WHEN c.call_duration LIKE '%:%:%' THEN SPLIT_PART(c.call_duration, ':', 1)::int * 3600 + SPLIT_PART(c.call_duration, ':', 2)::int * 60 + SPLIT_PART(c.call_duration, ':', 3)::int
  WHEN c.call_duration LIKE '%:%' THEN SPLIT_PART(c.call_duration, ':', 1)::int * 60 + SPLIT_PART(c.call_duration, ':', 2)::int
  ELSE 0 END)`;

export interface AgentRef { id: number; extension_number: string }

export interface CallItem {
  id: number;
  call_time: string;
  phone_number: string | null;
  duration_sec: number;
  call_duration: string;
  rec_id: string | null;
  play_url: string | null;
  download_url: string | null;
  qa: {
    transcript_id: number;
    status: string;
    transcript: string | null;
    overall_score: number | null;
    meeting_scheduled: boolean | null;
    disposition: string | null;
    not_evaluable: boolean | null;
    not_evaluable_reason: string | null;
  } | null;
}

export interface AgentShiftCalls {
  start_date: string | null;
  before_start: boolean;
  total_calls: number;
  calls: CallItem[];
  summary: { total_calls: number; long_calls: number; long_talk_seconds: number; with_recording: number; meetings: number };
}

interface CallRow {
  id: number;
  call_time: string;
  phone_number: string | null;
  agent_extension: string;
  call_duration: string;
  duration_sec: number;
  rec_id: string | null;
}

export async function loadShiftCalls(agents: AgentRef[], date: string, minSeconds = 60, opts: { transcripts?: boolean } = {}) {
  const settings = await getRecordingSettings();
  const window = shiftWindowPKT(date, settings);
  const startDates = await getAgentStartDates(agents.map((a) => a.id));
  const exts = Array.from(new Set(agents.map((a) => a.extension_number).filter(Boolean)));

  const rows = exts.length ? await query<CallRow>(
    `SELECT c.id, c.call_time, c.phone_number, c.agent_extension, c.call_duration, ${DURATION_SEC_SQL} AS duration_sec, c.rec_id
     FROM call_logs c
     WHERE c.agent_extension = ANY($1::text[])
       -- call_time is UTC without a zone: convert the PKT window to UTC explicitly
       AND c.call_time >= ($2::timestamp AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'UTC'
       AND c.call_time < ($3::timestamp AT TIME ZONE 'Asia/Karachi') AT TIME ZONE 'UTC'
     ORDER BY c.call_time ASC`,
    [exts, window.start, window.end]
  ) : [];

  // Per agent: drop everything if the shift is before their start date.
  const perAgent = new Map<number, { all: CallRow[]; long: CallRow[]; start: string | null; before: boolean }>();
  for (const a of agents) {
    const start = startDates.get(a.id) || null;
    const before = !!start && date < start;
    const all = before ? [] : rows.filter((r) => r.agent_extension === a.extension_number);
    perAgent.set(a.id, { all, long: all.filter((r) => Number(r.duration_sec) > minSeconds), start, before });
  }
  const longCalls = Array.from(perAgent.values()).flatMap((p) => p.long);

  // Match recordings once for every call that doesn't have one yet.
  let recordingsError: string | null = null;
  const needing = longCalls.filter((c) => !c.rec_id);
  if (needing.length) {
    const clientSecret = await getClientSecret();
    if (!clientSecret) {
      recordingsError = '3CX is not configured — add the recording access token in settings.';
    } else {
      const times = needing.map((c) => new Date(c.call_time).getTime());
      const from = new Date(Math.min(...times) - 6 * 3600 * 1000).toISOString().slice(0, 10);
      const to = new Date(Math.max(...times) + 6 * 3600 * 1000).toISOString().slice(0, 10);
      const { recordings, error } = await listRecordings(clientSecret, from, to);
      if (error) {
        recordingsError = `Could not reach 3CX: ${error}`;
      } else {
        const assigned = await assignForCalls(needing, recordings, {
          minSeconds: settings.recordingMinSeconds,
          windowMs: settings.matchWindowMinutes * 60 * 1000,
        });
        for (const c of needing) {
          const m = assigned.get(String(c.id));
          if (m) {
            c.rec_id = String(m.recording.Id);
            await query(`UPDATE call_logs SET rec_id = $1 WHERE id = $2`, [c.rec_id, c.id]);
          }
        }
      }
    }
  }

  // QA pipeline data keyed by 3CX recording id.
  const recIds = longCalls.map((c) => c.rec_id).filter((r): r is string => !!r && /^\d+$/.test(r));
  const qa = recIds.length
    ? await query<any>(
        `SELECT t.threecx_rec_id::text AS rec_id, t.id AS transcript_id, t.status::text AS status,
                ${opts.transcripts === false ? 'NULL' : 't.transcript'} AS transcript,
                e.overall_score, e.meeting_scheduled, e.disposition, e.not_evaluable, e.not_evaluable_reason
         FROM call_transcripts t
         LEFT JOIN call_evaluations e ON e.transcript_id = t.id
         WHERE t.threecx_rec_id = ANY($1::bigint[])`,
        [recIds]
      )
    : [];
  const qaByRec = new Map(qa.map((q) => [q.rec_id, q]));

  const toItem = async (c: CallRow): Promise<CallItem> => {
    const playUrl = c.rec_id ? await recordingPlayUrl(c.rec_id) : null;
    const q = c.rec_id ? qaByRec.get(c.rec_id) : null;
    return {
      id: c.id,
      call_time: c.call_time,
      phone_number: c.phone_number,
      duration_sec: Number(c.duration_sec),
      call_duration: c.call_duration,
      rec_id: c.rec_id,
      play_url: playUrl,
      download_url: playUrl ? `${playUrl}&download=1` : null,
      qa: q ? {
        transcript_id: Number(q.transcript_id),
        status: q.status,
        transcript: q.transcript ? String(q.transcript).slice(0, 20000) : null,
        overall_score: q.overall_score === null ? null : Number(q.overall_score),
        meeting_scheduled: q.meeting_scheduled,
        disposition: q.disposition,
        not_evaluable: q.not_evaluable,
        not_evaluable_reason: q.not_evaluable_reason,
      } : null,
    };
  };

  const byAgent = new Map<number, AgentShiftCalls>();
  for (const [id, p] of Array.from(perAgent.entries())) {
    const items = await Promise.all(p.long.map(toItem));
    byAgent.set(id, {
      start_date: p.start,
      before_start: p.before,
      total_calls: p.all.length,
      calls: items,
      summary: {
        total_calls: p.all.length,
        long_calls: items.length,
        long_talk_seconds: items.reduce((s, c) => s + c.duration_sec, 0),
        with_recording: items.filter((i) => i.rec_id).length,
        meetings: items.filter((i) => i.qa?.meeting_scheduled).length,
      },
    });
  }

  return {
    window: { start: window.start.slice(0, 16), end: window.end.slice(0, 16) }, // PKT wall clock
    byAgent,
    recordingsError,
  };
}
