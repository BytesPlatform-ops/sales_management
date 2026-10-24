import { NextRequest } from 'next/server';
import { queryOne, query } from '@/lib/db';
import { getAuth, handler, ok } from '@/lib/training/http';
import { getRampStatus } from '@/lib/training/ramp';
import { aiStatus } from '@/lib/training/ai';
import { getSettings } from '@/lib/training/settings';
import { buildPath, nextLesson } from '@/lib/training/progress';

export const dynamic = 'force-dynamic';

/** GET /api/training/me — the rep's training status at a glance. */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const user = await queryOne<any>(`SELECT id, username, full_name, role, created_at FROM users WHERE id = $1`, [auth.userId]);
  const settings = await getSettings();
  const [ai, unread] = await Promise.all([
    aiStatus(auth.userId),
    queryOne<{ n: string }>(`SELECT COUNT(*) AS n FROM training_notifications WHERE user_id = $1 AND read_at IS NULL`, [auth.userId]),
  ]);

  if (auth.role === 'hr') {
    return ok({ user, role: 'trainer', ai, unread_notifications: Number(unread?.n || 0), onboarding_days: settings.onboarding_days });
  }

  const [ramp, path, certs] = await Promise.all([
    getRampStatus(auth.userId),
    buildPath(auth.userId, settings.quiz_cooldown_minutes),
    query<any>(`SELECT code, granted_at, method FROM training_certifications WHERE user_id = $1 AND revoked_at IS NULL`, [auth.userId]),
  ]);
  const hiredDays = user?.created_at ? Math.floor((Date.now() - new Date(user.created_at).getTime()) / 86_400_000) + 1 : null;

  return ok({
    user, role: 'rep', ramp, certifications: certs,
    live_call_certified: certs.some((c) => c.code === 'LIVE_CALL_CERT'),
    next_lesson: nextLesson(path.tracks),
    tracks: path.tracks.map((t) => ({ code: t.code, title: t.title, progress_pct: t.progress_pct, completed: t.completed, cert: t.cert })),
    onboarding_days: settings.onboarding_days,
    onboarding_day: ramp.grandfathered ? null : hiredDays,
    ai, unread_notifications: Number(unread?.n || 0),
    dialer_blocked: settings.gate_enabled && settings.block_dialer_until_certified && !certs.some((c) => c.code === 'LIVE_CALL_CERT'),
  });
});
