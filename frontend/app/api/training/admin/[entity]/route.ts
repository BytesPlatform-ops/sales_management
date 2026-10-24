import { NextRequest } from 'next/server';
import { handler, ok, readJson, requireHr } from '@/lib/training/http';
import { createEntity, listEntity } from '@/lib/training/admin';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/training/admin/{entity} (trainer)
 * entity: tracks | courses | questions | flashcards | scenarios | objections | classification | gates | rubrics | badges
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { entity: string } }) => {
  await requireHr(request);
  return ok(await listEntity(params.entity, new URL(request.url).searchParams));
});

export const POST = handler(async (request: NextRequest, { params }: { params: { entity: string } }) => {
  await requireHr(request);
  return ok(await createEntity(params.entity, await readJson(request)));
});
