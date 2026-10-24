import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, requireHr } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** GET /api/training/lessons/{id}/questions (trainer) — quiz builder view, answers included. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  return ok(await query(`SELECT * FROM training_quiz_questions WHERE lesson_id = $1 ORDER BY id`, [Number(params.id)]));
});
