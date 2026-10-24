import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, requireHr, HttpError } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** POST /api/training/lessons/{id}/publish (trainer) — snapshot a new version and publish it. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await requireHr(request);
  const id = Number(params.id);
  const lesson = await queryOne<any>(
    `UPDATE training_lessons
     SET version = CASE WHEN EXISTS (SELECT 1 FROM training_lesson_versions WHERE lesson_id = $1) THEN version + 1 ELSE version END,
         published = true, updated_at = NOW()
     WHERE id = $1 RETURNING *`,
    [id]
  );
  if (!lesson) throw new HttpError(404, 'Lesson not found');
  await queryOne(
    `INSERT INTO training_lesson_versions (lesson_id, version, title, body_md, config, published_by)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)
     ON CONFLICT (lesson_id, version) DO UPDATE SET title = EXCLUDED.title, body_md = EXCLUDED.body_md,
       config = EXCLUDED.config, published_by = EXCLUDED.published_by, published_at = NOW()
     RETURNING id`,
    [id, lesson.version, lesson.title, lesson.body_md, JSON.stringify(lesson.config || {}), auth.userId]
  );
  return ok({ id, version: lesson.version, published: true });
});

/** GET /api/training/lessons/{id}/publish — version history. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  return ok(await query(
    `SELECT v.id, v.version, v.title, v.published_at, u.full_name AS published_by
     FROM training_lesson_versions v LEFT JOIN users u ON u.id = v.published_by
     WHERE v.lesson_id = $1 ORDER BY v.version DESC`,
    [Number(params.id)]
  ));
});
