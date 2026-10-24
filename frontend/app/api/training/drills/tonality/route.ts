import { NextRequest } from 'next/server';
import { getAuth, handler, ok, HttpError } from '@/lib/training/http';
import { transcribe, chatJSON, AiUnavailableError, STANDARD_MODE_MESSAGE } from '@/lib/training/ai';
import { tonalityStats, submitDrillItem } from '@/lib/training/daily';

export const dynamic = 'force-dynamic';

/**
 * POST /api/training/drills/tonality (multipart: audio, seconds, purpose=drill|voicemail)
 * Transcribes a short practice recording and returns pace + filler words (D.14),
 * or the voicemail checklist ("Hear yourself" grader, E.11).
 */
export const POST = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const form = await request.formData();
  const audio = form.get('audio');
  const seconds = Number(form.get('seconds') || 0);
  const purpose = String(form.get('purpose') || 'drill');
  if (!(audio instanceof Blob) || audio.size === 0) throw new HttpError(400, 'Attach a recording');
  if (audio.size > 10 * 1024 * 1024) throw new HttpError(413, 'Recording too long');

  try {
    const { text } = await transcribe(audio, `practice.${(audio.type.split('/')[1] || 'webm').split(';')[0]}`, auth.userId, seconds || undefined);
    const stats = tonalityStats(text, seconds);

    if (purpose === 'voicemail') {
      const r = await chatJSON<any>({
        feature: 'drill', userId: auth.userId, promptKey: 'voicemail_grade',
        vars: { seconds: seconds || Math.round(stats.words / 2.6), transcript: text }, maxTokens: 400,
      });
      return ok({ transcript: text, ...stats, voicemail: r.data, ai_used: true });
    }

    const drill = await submitDrillItem(auth.userId, { kind: 'tonality', id: 0 }, { transcript: text, seconds });
    return ok({ transcript: text, ...stats, drill, ai_used: true });
  } catch (err) {
    if (err instanceof AiUnavailableError) {
      return ok({ ai_used: false, ai_message: err.message || STANDARD_MODE_MESSAGE, self_rate: true });
    }
    throw err;
  }
});
