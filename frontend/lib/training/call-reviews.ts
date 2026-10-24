/**
 * AI call grading against the 100-point rubric (E.5).
 * Sources: an uploaded recording, or a call the existing QA pipeline already
 * transcribed (call_transcripts) — no second transcription cost.
 * Pipeline: transcript → grade (structured JSON, evidence per criterion) →
 * review queue if <60, >90, or last AI/human gap >15. Trainer can override.
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from './http';
import { chatJSON, transcribe, AiUnavailableError, STANDARD_MODE_MESSAGE } from './ai';
import { buildScoreCard, loadRubric, needsHumanReview, ScoreCard } from './scorecard';
import { lastAiHumanGap } from './roleplay';
import { notifyTrainers } from './events';

const MIN_GRADE_SECONDS = 60; // E.5: grade only connected conversations

async function gradeTranscript(userId: number, transcript: string, context: string): Promise<ScoreCard> {
  const rubric = await loadRubric();
  const r = await chatJSON<any>({
    feature: 'grading', userId, promptKey: 'call_grade',
    vars: { context, transcript: transcript.slice(0, 40_000) }, maxTokens: 1500,
  });
  return buildScoreCard(rubric, r.data, 'ai');
}

async function applyScore(reviewId: number, userId: number, card: ScoreCard) {
  const gap = await lastAiHumanGap(userId);
  const status = needsHumanReview(card.total, gap) ? 'needs_review' : 'scored';
  await query(
    `UPDATE training_call_reviews SET ai_score_json = $2::jsonb, final_score = $3, status = $4, error = NULL WHERE id = $1`,
    [reviewId, JSON.stringify(card), card.total, status]
  );
  if (status === 'needs_review') await notifyTrainers('review_queue', `A call (#${reviewId}) scored ${card.total} and needs review.`, '/hr/training/reviews');
}

export async function createFromUpload(userId: number, file: File, durationS?: number) {
  if (file.size > 25 * 1024 * 1024) throw new HttpError(413, 'Audio must be under 25 MB');
  const buf = Buffer.from(await file.arrayBuffer());
  const review = await queryOne<{ id: number }>(
    `INSERT INTO training_call_reviews (user_id, source, duration_s, status) VALUES ($1, 'upload', $2, 'pending') RETURNING id`,
    [userId, durationS ?? null]
  );
  await query(
    `INSERT INTO training_call_audio (review_id, mime_type, data) VALUES ($1, $2, $3)`,
    [review!.id, file.type || 'audio/mpeg', buf]
  );
  await query(`UPDATE training_call_reviews SET audio_url = $2 WHERE id = $1`, [review!.id, `/api/training/call-reviews/${review!.id}/audio`]);
  return processReview(review!.id, userId, file);
}

export async function createFromQaTranscript(userId: number, transcriptId: number, isTrainer: boolean) {
  const t = await queryOne<any>(
    `SELECT id, agent_id, transcript, duration_sec, shift_date, recording_url FROM call_transcripts WHERE id = $1`,
    [transcriptId]
  );
  if (!t) throw new HttpError(404, 'Call not found');
  if (!isTrainer && Number(t.agent_id) !== userId) throw new HttpError(403, 'That call is not yours');
  if (!t.transcript) throw new HttpError(409, 'That call has not been transcribed yet');
  if ((t.duration_sec || 0) < MIN_GRADE_SECONDS) throw new HttpError(400, 'Only calls longer than 60 seconds are graded');

  const existing = await queryOne<{ id: number }>(`SELECT id FROM training_call_reviews WHERE call_transcript_id = $1`, [transcriptId]);
  if (existing) return getReview(existing.id);

  const review = await queryOne<{ id: number }>(
    `INSERT INTO training_call_reviews (user_id, source, call_transcript_id, duration_s, transcript, status)
     VALUES ($1, 'qa_transcript', $2, $3, $4, 'pending') RETURNING id`,
    [Number(t.agent_id), transcriptId, t.duration_sec, t.transcript]
  );
  return processReview(review!.id, Number(t.agent_id));
}

/** Transcribe (if needed) and grade. Leaves the review in the trainer queue when AI is unavailable. */
export async function processReview(reviewId: number, userId: number, file?: Blob) {
  const review = await queryOne<any>(`SELECT * FROM training_call_reviews WHERE id = $1`, [reviewId]);
  if (!review) throw new HttpError(404, 'Review not found');
  try {
    let transcript: string = review.transcript;
    if (!transcript) {
      let audio = file;
      if (!audio) {
        const a = await queryOne<{ mime_type: string; data: Buffer }>(`SELECT mime_type, data FROM training_call_audio WHERE review_id = $1`, [reviewId]);
        if (!a) throw new HttpError(409, 'Audio no longer available');
        audio = new Blob([new Uint8Array(a.data)], { type: a.mime_type });
      }
      const ext = (audio.type.split('/')[1] || 'mp3').replace('mpeg', 'mp3');
      transcript = (await transcribe(audio, `call-${reviewId}.${ext}`, userId, review.duration_s ?? undefined)).text;
      await query(`UPDATE training_call_reviews SET transcript = $2 WHERE id = $1`, [reviewId, transcript]);
    }
    if (transcript.trim().split(/\s+/).length < 40) {
      await query(`UPDATE training_call_reviews SET status = 'failed', error = 'Too short to grade (not a connected conversation)' WHERE id = $1`, [reviewId]);
      return getReview(reviewId);
    }
    const card = await gradeTranscript(userId, transcript, `Real cold call (${review.source}).`);
    await applyScore(reviewId, userId, card);
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      // Fallback (E.5): trainer grades with the same rubric form.
      await query(`UPDATE training_call_reviews SET status = 'needs_review', error = $2 WHERE id = $1`, [reviewId, STANDARD_MODE_MESSAGE]);
      await notifyTrainers('review_queue', `Call #${reviewId} needs manual grading (AI unavailable).`, '/hr/training/reviews');
    } else {
      await query(`UPDATE training_call_reviews SET status = 'failed', error = $2 WHERE id = $1`, [reviewId, String((err as Error).message).slice(0, 500)]);
      if (err instanceof HttpError) throw err;
    }
  }
  return getReview(reviewId);
}

export async function getReview(id: number) {
  return queryOne<any>(
    `SELECT r.id, r.user_id, u.full_name, r.source, r.call_transcript_id, r.audio_url, r.audio_deleted_at, r.duration_s,
            r.transcript, r.ai_score_json, r.trainer_override_json, r.final_score, r.status, r.error, r.trainer_comment,
            r.reviewed_by, r.reviewed_at, r.created_at,
            EXISTS (SELECT 1 FROM training_call_audio a WHERE a.review_id = r.id) AS has_audio
     FROM training_call_reviews r LEFT JOIN users u ON u.id = r.user_id WHERE r.id = $1`,
    [id]
  );
}

/** Trainer override / manual grade — same rubric, same scorecard shape. */
export async function trainerScore(
  kind: 'call' | 'roleplay', id: number, trainerId: number,
  body: { criteria: { id: string; points: number; tip?: string }[]; auto_fail?: string[]; comment?: string }
) {
  const rubric = await loadRubric();
  const card = buildScoreCard(rubric, { criteria: body.criteria || [], auto_fail: body.auto_fail || [], top_3_tips: [] }, 'trainer');
  if (kind === 'call') {
    await query(
      `UPDATE training_call_reviews SET trainer_override_json = $2::jsonb, final_score = $3, status = 'reviewed',
         trainer_comment = $4, reviewed_by = $5, reviewed_at = NOW() WHERE id = $1`,
      [id, JSON.stringify(card), card.total, body.comment ?? null, trainerId]
    );
  } else {
    await query(
      `UPDATE training_roleplay_sessions SET trainer_score_json = $2::jsonb, final_score = $3, status = 'reviewed',
         human_reviewed = true, trainer_comment = $4, reviewed_by = $5, reviewed_at = NOW() WHERE id = $1`,
      [id, JSON.stringify(card), card.total, body.comment ?? null, trainerId]
    );
  }
  return card;
}

/** Trainer confirms the AI score as-is (counts as human-reviewed). */
export async function confirmRoleplay(id: number, trainerId: number, comment?: string) {
  await query(
    `UPDATE training_roleplay_sessions SET status = 'reviewed', human_reviewed = true, trainer_comment = COALESCE($2, trainer_comment),
       reviewed_by = $3, reviewed_at = NOW() WHERE id = $1 AND final_score IS NOT NULL`,
    [id, comment ?? null, trainerId]
  );
}

/** Nightly: delete raw audio after the retention window; keep transcripts and scores. */
export async function purgeOldAudio(retentionDays: number) {
  const rows = await query<{ review_id: number }>(
    `DELETE FROM training_call_audio WHERE created_at < NOW() - ($1 || ' days')::interval RETURNING review_id`,
    [String(retentionDays)]
  );
  if (rows.length) {
    await query(`UPDATE training_call_reviews SET audio_deleted_at = NOW() WHERE id = ANY($1::int[])`, [rows.map((r) => r.review_id)]);
  }
  return rows.length;
}
