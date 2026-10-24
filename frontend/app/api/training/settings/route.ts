import { NextRequest } from 'next/server';
import { getAuth, handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { getSettings, setSetting, DEFAULT_SETTINGS, TrainingSettings } from '@/lib/training/settings';

export const dynamic = 'force-dynamic';

/** GET /api/training/settings */
export const GET = handler(async (request: NextRequest) => {
  await getAuth(request);
  return ok(await getSettings());
});

/** PUT /api/training/settings (admin) { key: value, ... } — only known keys are accepted. */
export const PUT = handler(async (request: NextRequest) => {
  const auth = await requireHr(request);
  const b = await readJson<Record<string, unknown>>(request);
  const keys = Object.keys(b).filter((k) => k in DEFAULT_SETTINGS && k !== 'launched_at');
  if (!keys.length) throw new HttpError(400, 'No known settings in body');
  for (const k of keys) {
    const def = (DEFAULT_SETTINGS as any)[k];
    const v = b[k];
    if (typeof def === 'boolean' && typeof v !== 'boolean') throw new HttpError(400, `${k} must be true/false`);
    if (typeof def === 'number' && typeof v !== 'number') throw new HttpError(400, `${k} must be a number`);
    await setSetting(k as keyof TrainingSettings, v, auth.userId);
  }
  return ok(await getSettings());
});
