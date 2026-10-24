import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

const TYPES = ['reading', 'video', 'flashcard_deck', 'quiz', 'exam', 'roleplay', 'scenario', 'checklist', 'drill'];

/** POST /api/training/lessons (trainer) — new lessons start unpublished. */
export const POST = handler(async (request: NextRequest) => {
  await requireHr(request);
  const b = await readJson(request);
  if (!b.course_id || !b.code || !b.title || !TYPES.includes(b.type)) throw new HttpError(400, 'course_id, code, title and a valid type are required');
  const lesson = await queryOne(
    `INSERT INTO training_lessons (course_id, code, type, title, body_md, media_url, est_minutes, sort_order, required, pass_pct, config, published)
     VALUES ($1,$2,$3,$4,$5,$6,$7,
       COALESCE($8, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM training_lessons WHERE course_id = $1)),
       $9,$10,$11::jsonb,false) RETURNING *`,
    [b.course_id, b.code, b.type, b.title, b.body_md || '', b.media_url || null, b.est_minutes || 5, b.sort_order ?? null,
      b.required ?? true, b.pass_pct ?? 80, JSON.stringify(b.config || {})]
  );
  return ok(lesson);
});
