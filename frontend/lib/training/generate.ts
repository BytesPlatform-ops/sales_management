/**
 * Auto-generated flashcards & quiz questions from a lesson (E.6). The trainer
 * previews the output and saves what they keep — nothing is published blindly.
 */
import { queryOne } from '@/lib/db';
import { chatJSON } from './ai';
import { HttpError } from './http';

async function lessonText(lessonId: number) {
  const l = await queryOne<{ title: string; body_md: string }>(`SELECT title, body_md FROM training_lessons WHERE id = $1`, [lessonId]);
  if (!l) throw new HttpError(404, 'Lesson not found');
  if (!l.body_md || l.body_md.length < 200) throw new HttpError(400, 'Lesson text is too short to generate from');
  return `# ${l.title}\n\n${l.body_md}`.slice(0, 24_000);
}

export async function generateFlashcards(trainerId: number, lessonId: number, n = 10) {
  const text = await lessonText(lessonId);
  const r = await chatJSON<{ cards: { front: string; back: string }[] }>({
    feature: 'generate', userId: trainerId, promptKey: 'generate_flashcards', vars: { n, text }, maxTokens: 1500,
  });
  return r.data.cards || [];
}

export async function generateQuiz(trainerId: number, lessonId: number, m = 8) {
  const text = await lessonText(lessonId);
  const r = await chatJSON<{ questions: { prompt: string; options: string[]; correct: number; explanation: string }[] }>({
    feature: 'generate', userId: trainerId, promptKey: 'generate_quiz', vars: { m, text }, maxTokens: 2500,
  });
  return (r.data.questions || []).filter((q) => Array.isArray(q.options) && q.options.length >= 2 && q.correct >= 0 && q.correct < q.options.length);
}
