/**
 * Run a background job on at most one web instance at a time.
 *
 * Uses a lease row in job_locks rather than pg_advisory_lock: we connect through
 * Supabase's transaction pooler, where a session advisory lock can land on a
 * different backend connection than the job's queries and silently not hold.
 * A single UPDATE … WHERE locked_until < NOW() RETURNING is atomic either way.
 *
 * The lease expires after ttlMs so a crashed instance can't block the job
 * forever; keep ttlMs comfortably above the job's longest run.
 * minIntervalMs additionally skips the job if any instance ran it more recently.
 */
import os from 'os';
import { query, queryOne } from '@/lib/db';

const OWNER = `${os.hostname()}:${process.pid}`;
let warnedMissing = false;

export interface JobLockOptions {
  ttlMs: number;
  minIntervalMs?: number;
}

/** Returns true if this instance claimed the lease. */
export async function claimJob(name: string, { ttlMs, minIntervalMs = 0 }: JobLockOptions): Promise<boolean> {
  await query(`INSERT INTO job_locks (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`, [name]);
  const row = await queryOne(
    `UPDATE job_locks
        SET locked_until = NOW() + ($2::int * INTERVAL '1 millisecond'), locked_by = $3
      WHERE name = $1
        AND locked_until < NOW()
        AND (last_run_at IS NULL OR last_run_at <= NOW() - ($4::int * INTERVAL '1 millisecond'))
      RETURNING name`,
    [name, ttlMs, OWNER, minIntervalMs]
  );
  return !!row;
}

export async function releaseJob(name: string): Promise<void> {
  await query(
    `UPDATE job_locks SET locked_until = 'epoch', last_run_at = NOW() WHERE name = $1 AND locked_by = $2`,
    [name, OWNER]
  );
}

/**
 * Runs fn if the lease is free. Before the job_locks migration is applied it
 * runs fn unlocked (the old behaviour) so deploying code first doesn't stop jobs.
 */
export async function withJobLock(name: string, opts: JobLockOptions, fn: () => Promise<unknown>): Promise<boolean> {
  let claimed: boolean;
  try {
    claimed = await claimJob(name, opts);
  } catch (err) {
    if (!/job_locks.*does not exist/.test(String((err as Error)?.message))) throw err;
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn('[job-lock] job_locks table missing; running jobs unlocked until the migration is applied');
    }
    await fn();
    return true;
  }
  if (!claimed) return false;
  try {
    await fn();
  } finally {
    await releaseJob(name).catch((err) => console.error(`[job-lock] release ${name}`, err));
  }
  return true;
}
