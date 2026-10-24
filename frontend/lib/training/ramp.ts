/**
 * Ramp status (B.3 ramp_status, B.9 hooks).
 *
 * TRAINING → (LIVE_CALL_CERT) → RAMP_50 → RAMP_75 → FULL, with SUPERVISED as a
 * trainer-set pause that can interrupt any phase. Every change is written to
 * training_ramp_history so payroll can apply the right rule to each past day.
 *
 * Payroll rule (read by lib/salary-utils + payroll/stats routes):
 *   phase in penalty_free_phases → no missed-target deductions (score = 100%)
 *   otherwise targets are scaled by quota_multiplier (RAMP_75 = 75% of quota)
 */
import { query, queryOne } from '@/lib/db';
import { emitEvent, notify } from './events';
import { getSettings } from './settings';

export type RampPhase = 'TRAINING' | 'SUPERVISED' | 'RAMP_50' | 'RAMP_75' | 'FULL';

export interface RampStatus {
  user_id: number;
  phase: RampPhase;
  phase_started_at: string;
  quota_multiplier: number;
  certified_at: string | null;
  supervised_reason: string | null;
  phase_before_supervised: RampPhase | null;
  grandfathered: boolean;
}

export interface RampDayInfo {
  phase: RampPhase;
  multiplier: number;
  penaltyFree: boolean;
}

const FULL_DAY: RampDayInfo = { phase: 'FULL', multiplier: 1, penaltyFree: false };

async function multiplierFor(phase: RampPhase): Promise<number> {
  const s = await getSettings();
  if (phase === 'RAMP_50') return s.ramp_schedule.RAMP_50?.multiplier ?? 0.5;
  if (phase === 'RAMP_75') return s.ramp_schedule.RAMP_75?.multiplier ?? 0.75;
  if (phase === 'FULL') return 1;
  return 0; // TRAINING / SUPERVISED: no quota (penalty-free)
}

/**
 * Current status. Creates the row lazily: agents created before the module
 * launched are grandfathered (FULL, certified); anyone newer starts in TRAINING.
 */
export async function getRampStatus(userId: number): Promise<RampStatus> {
  const existing = await queryOne<RampStatus>(`SELECT * FROM training_ramp_status WHERE user_id = $1`, [userId]);
  if (existing) return { ...existing, quota_multiplier: Number(existing.quota_multiplier) };

  const s = await getSettings();
  const user = await queryOne<{ created_at: string | null }>(`SELECT created_at FROM users WHERE id = $1`, [userId]);
  const grandfathered = !s.gate_enabled || !user?.created_at || new Date(user.created_at) < new Date(s.launched_at);
  const phase: RampPhase = grandfathered ? 'FULL' : 'TRAINING';
  const multiplier = grandfathered ? 1 : 0;

  await query(
    `INSERT INTO training_ramp_status (user_id, phase, quota_multiplier, certified_at, grandfathered)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (user_id) DO NOTHING`,
    [userId, phase, multiplier, grandfathered ? new Date().toISOString() : null, grandfathered]
  );
  await query(
    `INSERT INTO training_ramp_history (user_id, phase, quota_multiplier, started_at, reason)
     SELECT $1, $2, $3, $4, $5
     WHERE NOT EXISTS (SELECT 1 FROM training_ramp_history WHERE user_id = $1)`,
    [userId, phase, multiplier, grandfathered ? '2000-01-01T00:00:00Z' : (user?.created_at || new Date().toISOString()),
      grandfathered ? 'grandfathered' : 'new rep: training']
  );
  return (await queryOne<RampStatus>(`SELECT * FROM training_ramp_status WHERE user_id = $1`, [userId]))!;
}

export async function setPhase(userId: number, phase: RampPhase, reason: string, extra: { supervisedReason?: string } = {}) {
  const current = await getRampStatus(userId);
  if (current.phase === phase && phase !== 'SUPERVISED') return current;
  const multiplier = await multiplierFor(phase);
  const now = new Date().toISOString();

  await query(
    `UPDATE training_ramp_history SET ended_at = $2 WHERE user_id = $1 AND ended_at IS NULL`,
    [userId, now]
  );
  await query(
    `INSERT INTO training_ramp_history (user_id, phase, quota_multiplier, started_at, reason) VALUES ($1, $2, $3, $4, $5)`,
    [userId, phase, multiplier, now, reason]
  );
  await query(
    `UPDATE training_ramp_status
     SET phase = $2::varchar, quota_multiplier = $3, phase_started_at = $4::timestamptz, updated_at = $4::timestamptz,
         supervised_reason = CASE WHEN $2::varchar = 'SUPERVISED' THEN $5::text ELSE NULL END,
         phase_before_supervised = CASE WHEN $2::varchar = 'SUPERVISED' THEN COALESCE(phase_before_supervised, $6::varchar) ELSE NULL END
     WHERE user_id = $1`,
    [userId, phase, multiplier, now, extra.supervisedReason ?? null, current.phase]
  );

  await emitEvent('training.ramp_phase_changed', {
    user_id: userId, phase, previous_phase: current.phase, quota_multiplier: multiplier, reason,
  });
  if (phase === 'SUPERVISED') {
    await emitEvent('training.supervised_flag', { user_id: userId, reason: extra.supervisedReason || reason });
  }
  await notify(userId, 'ramp_phase', `Your quota phase is now ${phase.replace('_', ' ')} (${Math.round(multiplier * 100)}% quota).`, '/agent/training');
  return getRampStatus(userId);
}

/** Called when LIVE_CALL_CERT is granted: quota credit starts, ramp begins. */
export async function onLiveCallCertified(userId: number) {
  const status = await getRampStatus(userId);
  const now = new Date().toISOString();
  await query(`UPDATE training_ramp_status SET certified_at = COALESCE(certified_at, $2) WHERE user_id = $1`, [userId, now]);
  await emitEvent('training.certified', { user_id: userId, cert: 'LIVE_CALL_CERT', date: now });
  if (status.phase === 'TRAINING') await setPhase(userId, 'RAMP_50', 'LIVE_CALL_CERT granted');
}

export async function setSupervised(userId: number, on: boolean, reason: string) {
  const status = await getRampStatus(userId);
  if (on) return setPhase(userId, 'SUPERVISED', 'trainer set SUPERVISED', { supervisedReason: reason });
  if (status.phase !== 'SUPERVISED') return status;
  const back: RampPhase = status.phase_before_supervised || (status.certified_at ? 'RAMP_50' : 'TRAINING');
  return setPhase(userId, back, `supervision lifted: ${reason || 'trainer'}`);
}

/** Daily job: move reps through RAMP_50 → RAMP_75 → FULL on schedule. */
export async function advanceRampPhases(): Promise<number> {
  const s = await getSettings();
  const due = await query<{ user_id: number; phase: RampPhase }>(
    `SELECT user_id, phase FROM training_ramp_status
     WHERE (phase = 'RAMP_50' AND phase_started_at <= NOW() - ($1 || ' days')::interval)
        OR (phase = 'RAMP_75' AND phase_started_at <= NOW() - ($2 || ' days')::interval)`,
    [String(s.ramp_schedule.RAMP_50?.days ?? 30), String(s.ramp_schedule.RAMP_75?.days ?? 30)]
  );
  for (const row of due) {
    await setPhase(row.user_id, row.phase === 'RAMP_50' ? 'RAMP_75' : 'FULL', 'ramp schedule');
  }
  return due.length;
}

// ------------------------------------------------------------------ payroll lookup

interface HistoryRow { user_id: number; phase: RampPhase; quota_multiplier: string; start_date: string }

export type RampLookup = (userId: number, date: string) => RampDayInfo;

/**
 * Load the phase timeline for many users at once and return a lookup that
 * resolves (user, YYYY-MM-DD) → phase in effect at the end of that day (PKT).
 * Users without history (module not installed / legacy) are FULL.
 */
export async function loadRampLookup(userIds: number[]): Promise<RampLookup> {
  if (userIds.length === 0) return () => FULL_DAY;
  let rows: HistoryRow[] = [];
  let penaltyFree = new Set<string>();
  try {
    const s = await getSettings();
    penaltyFree = new Set(s.penalty_free_phases);
    rows = await query<HistoryRow>(
      `SELECT user_id, phase, quota_multiplier,
              (started_at AT TIME ZONE 'Asia/Karachi')::date::text AS start_date
       FROM training_ramp_history
       WHERE user_id = ANY($1::bigint[])
       ORDER BY user_id, started_at`,
      [userIds]
    );
  } catch (err) {
    if (!/does not exist/.test(String((err as Error)?.message))) console.error('[training] ramp lookup', err);
    return () => FULL_DAY;
  }

  const byUser = new Map<number, HistoryRow[]>();
  for (const r of rows) {
    const key = Number(r.user_id);
    if (!byUser.has(key)) byUser.set(key, []);
    byUser.get(key)!.push(r);
  }

  return (userId: number, date: string) => {
    const timeline = byUser.get(Number(userId));
    if (!timeline || timeline.length === 0) return FULL_DAY;
    // Last entry that started on or before this date; earlier dates use the first entry.
    let entry = timeline[0];
    for (const r of timeline) {
      if (r.start_date <= date) entry = r;
      else break;
    }
    return {
      phase: entry.phase,
      multiplier: Number(entry.quota_multiplier),
      penaltyFree: penaltyFree.has(entry.phase),
    };
  };
}
