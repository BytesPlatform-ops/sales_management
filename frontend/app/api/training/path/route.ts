import { NextRequest } from 'next/server';
import { getAuth, handler, ok, resolveTargetUser } from '@/lib/training/http';
import { buildPath, nextLesson } from '@/lib/training/progress';
import { getSettings } from '@/lib/training/settings';

export const dynamic = 'force-dynamic';

/** GET /api/training/path[?user_id=] — "My Path": tracks → courses → lessons with lock state. */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const userId = resolveTargetUser(auth, new URL(request.url).searchParams.get('user_id'));
  const settings = await getSettings();
  const { tracks } = await buildPath(userId, settings.quiz_cooldown_minutes);
  return ok({ tracks, next_lesson: nextLesson(tracks), onboarding_days: settings.onboarding_days });
});
