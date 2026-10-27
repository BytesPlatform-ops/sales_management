import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn(), queryOne: vi.fn() }));
vi.mock('@/lib/db', () => db);

import { withJobLock } from '@/lib/job-lock';

beforeEach(() => { db.query.mockReset().mockResolvedValue([]); db.queryOne.mockReset(); });

describe('withJobLock', () => {
  it('runs the job and releases the lease when claimed', async () => {
    db.queryOne.mockResolvedValue({ name: 'job' });
    const fn = vi.fn().mockResolvedValue(undefined);
    expect(await withJobLock('job', { ttlMs: 1000 }, fn)).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
    expect(db.query.mock.calls.at(-1)![0]).toMatch(/SET locked_until = 'epoch', last_run_at = NOW\(\)/);
  });

  it('skips the job when another instance holds the lease', async () => {
    db.queryOne.mockResolvedValue(null);
    const fn = vi.fn();
    expect(await withJobLock('job', { ttlMs: 1000 }, fn)).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('claims only when the lease expired and the minimum interval passed', async () => {
    db.queryOne.mockResolvedValue(null);
    await withJobLock('hourly', { ttlMs: 600_000, minIntervalMs: 3_600_000 }, vi.fn());
    const [sql, params] = db.queryOne.mock.calls[0];
    expect(sql).toMatch(/locked_until < NOW\(\)/);
    expect(sql).toMatch(/last_run_at <= NOW\(\)/);
    expect(params).toEqual(['hourly', 600_000, expect.any(String), 3_600_000]);
  });

  it('releases the lease even when the job throws', async () => {
    db.queryOne.mockResolvedValue({ name: 'job' });
    await expect(withJobLock('job', { ttlMs: 1000 }, () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    expect(db.query.mock.calls.at(-1)![0]).toMatch(/locked_until = 'epoch'/);
  });

  it('runs unlocked (old behaviour) before the migration is applied', async () => {
    db.query.mockRejectedValueOnce(new Error('relation "job_locks" does not exist'));
    const fn = vi.fn().mockResolvedValue(undefined);
    expect(await withJobLock('job', { ttlMs: 1000 }, fn)).toBe(true);
    expect(fn).toHaveBeenCalledOnce();
  });
});
