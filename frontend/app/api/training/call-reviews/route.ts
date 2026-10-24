import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok, HttpError } from '@/lib/training/http';
import { createFromQaTranscript, createFromUpload } from '@/lib/training/call-reviews';
import { evaluateBadges } from '@/lib/training/badges';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/** GET /api/training/call-reviews?status=needs_review&user_id= — reps see their own; trainers see all. */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const sp = new URL(request.url).searchParams;
  const where: string[] = [];
  const vals: any[] = [];
  if (auth.role !== 'hr') {
    vals.push(auth.userId);
    where.push(`r.user_id = $${vals.length}`);
  } else if (sp.get('user_id')) {
    vals.push(Number(sp.get('user_id')));
    where.push(`r.user_id = $${vals.length}`);
  }
  if (sp.get('status')) {
    vals.push(sp.get('status'));
    where.push(`r.status = $${vals.length}`);
  }
  const rows = await query(
    `SELECT r.id, r.user_id, u.full_name, r.source, r.call_transcript_id, r.duration_s, r.final_score, r.status, r.error,
            (r.ai_score_json->>'total')::numeric AS ai_total, (r.trainer_override_json->>'total')::numeric AS trainer_total,
            r.created_at, r.reviewed_at
     FROM training_call_reviews r LEFT JOIN users u ON u.id = r.user_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.created_at DESC LIMIT 100`,
    vals
  );
  return ok(rows);
});

/**
 * POST /api/training/call-reviews
 *   multipart: audio (file), duration_s?            — upload a recording
 *   JSON: { call_transcript_id }                     — grade a call the QA pipeline already transcribed
 */
export const POST = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const type = request.headers.get('content-type') || '';
  let review;
  if (type.includes('multipart/form-data')) {
    const form = await request.formData();
    const audio = form.get('audio');
    if (!(audio instanceof File) || audio.size === 0) throw new HttpError(400, 'Attach an audio file');
    review = await createFromUpload(auth.userId, audio, form.get('duration_s') ? Number(form.get('duration_s')) : undefined);
  } else {
    const b = await request.json().catch(() => ({}));
    if (!b.call_transcript_id) throw new HttpError(400, 'call_transcript_id or an audio upload is required');
    review = await createFromQaTranscript(auth.userId, Number(b.call_transcript_id), auth.role === 'hr');
  }
  if (review?.user_id) await evaluateBadges(Number(review.user_id));
  return ok(review);
});
