import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { deckCards } from '@/lib/training/daily';
import { parseFlashcardCsv } from '@/lib/training/admin';

export const dynamic = 'force-dynamic';

/** GET /api/training/lessons/{id}/flashcards — cards in a deck. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await getAuth(request);
  return ok(await deckCards(Number(params.id)));
});

/**
 * POST /api/training/lessons/{id}/flashcards (trainer)
 * body: { csv: "front,back,tags\n..." } (bulk import) or { cards: [{front, back, tags}] }
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  const b = await readJson(request);
  const cards = typeof b.csv === 'string' ? parseFlashcardCsv(b.csv) : Array.isArray(b.cards) ? b.cards : [];
  if (!cards.length) throw new HttpError(400, 'No cards found (CSV needs front,back[,tags] per row)');
  const deckId = Number(params.id);
  const start = await query<{ m: number }>(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM training_flashcards WHERE deck_lesson_id = $1`, [deckId]);
  let order = Number(start[0]?.m || 0);
  for (const c of cards) {
    if (!c.front || !c.back) continue;
    await query(
      `INSERT INTO training_flashcards (deck_lesson_id, front, back, tags, sort_order) VALUES ($1, $2, $3, $4, $5)`,
      [deckId, String(c.front).slice(0, 500), String(c.back).slice(0, 1000), Array.isArray(c.tags) ? c.tags : [], ++order]
    );
  }
  return ok({ imported: cards.length });
});
