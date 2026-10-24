import { NextRequest } from 'next/server';
import { getAuth, handler, ok, HttpError } from '@/lib/training/http';
import { loadOwnSession } from '@/lib/training/roleplay';
import { createRealtimeSession, voiceSecondsToday } from '@/lib/training/ai';
import { getPrompt, renderTemplate } from '@/lib/training/prompts';
import { getSettings } from '@/lib/training/settings';

export const dynamic = 'force-dynamic';

/**
 * POST /api/training/roleplays/{id}/voice-token — optional voice roleplay (E.3).
 * Returns a short-lived Realtime client secret; daily minutes are capped.
 */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const s = await loadOwnSession(Number(params.id), auth.userId);
  if (s.mode !== 'voice' || s.engine !== 'ai') throw new HttpError(400, 'Start a voice roleplay first');
  const settings = await getSettings();
  const used = await voiceSecondsToday(auth.userId);
  const capSeconds = settings.ai_caps.voice_minutes_per_day * 60;
  if (used >= capSeconds) throw new HttpError(429, `Daily voice limit reached (${settings.ai_caps.voice_minutes_per_day} min). Use text mode.`);

  const prompt = await getPrompt('roleplay_prospect');
  const p = s.persona_json || {};
  const vars = { persona: JSON.stringify(p.persona || p), objections: (p.objections || []).join(' | '), objective: p.objective || '', difficulty: p.difficulty || 2 };
  const instructions = `${renderTemplate(prompt.system_prompt, vars)}\n\n${renderTemplate(prompt.user_template, vars)}\nSpeak naturally, like a phone call. Do not say the [END] token out loud; just hang up politely.`;
  const token = await createRealtimeSession(auth.userId, instructions);
  return ok({ ...token, seconds_left_today: Math.max(0, Math.round(capSeconds - used)) });
});
