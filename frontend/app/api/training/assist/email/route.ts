import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { getAuth, handler, ok, readJson, HttpError } from '@/lib/training/http';
import { draftFollowupEmail } from '@/lib/training/assist';

export const dynamic = 'force-dynamic';

/** POST /api/training/assist/email { company, observation } — draft follow-up email #1 after a VM (rep edits before sending). */
export const POST = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const b = await readJson(request);
  if (!b.company) throw new HttpError(400, 'company is required');
  const me = await queryOne<{ email_name: string | null; full_name: string }>(`SELECT email_name, full_name FROM users WHERE id = $1`, [auth.userId]);
  return ok(await draftFollowupEmail(auth.userId, { company: String(b.company), observation: String(b.observation || ''), rep: me?.email_name || me?.full_name?.split(' ')[0] || 'Your rep' }));
});
