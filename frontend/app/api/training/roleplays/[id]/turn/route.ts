import { NextRequest } from 'next/server';
import { getAuth, handler, ok, readJson } from '@/lib/training/http';
import { takeTurn } from '@/lib/training/roleplay';

export const dynamic = 'force-dynamic';

/** POST /api/training/roleplays/{id}/turn { text } (AI engine) or { choice } (scripted engine) */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const b = await readJson(request);
  return ok(await takeTurn(Number(params.id), auth.userId, { text: b.text, choice: b.choice }));
});
