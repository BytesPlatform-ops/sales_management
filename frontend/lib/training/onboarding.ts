/**
 * New-rep setup, called when HR creates an agent: ramp row in TRAINING and the
 * 3-day onboarding path assigned (Track 1 due end of Day 1, Track 2 end of Day 3).
 */
import { query } from '@/lib/db';
import { getRampStatus } from './ramp';
import { getSettings } from './settings';
import { notify } from './events';

export async function startOnboarding(userId: number, assignedBy: number | null) {
  const settings = await getSettings();
  if (!settings.gate_enabled) return;
  await getRampStatus(userId); // created after launch → TRAINING

  const days = Math.max(1, settings.onboarding_days || 3);
  const dueAt = (day: number) => {
    const d = new Date();
    d.setDate(d.getDate() + day - 1);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
  };
  const tracks = await query<{ id: number; code: string }>(`SELECT id, code FROM training_tracks WHERE code IN ('T1', 'T2')`);
  for (const t of tracks) {
    await query(
      `INSERT INTO training_assignments (user_id, track_id, assigned_by, due_at)
       SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM training_assignments WHERE user_id = $1 AND track_id = $2)`,
      [userId, t.id, assignedBy, dueAt(t.code === 'T1' ? 1 : days)]
    );
  }
  await notify(userId, 'welcome', `Welcome! Your ${days}-day onboarding is ready: finish Product Knowledge on Day 1 and get Live-Calling certified by Day ${days}.`, '/agent/training');
}
