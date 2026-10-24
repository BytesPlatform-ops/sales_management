import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok, readJson, resolveTargetUser } from '@/lib/training/http';
import { startSession } from '@/lib/training/roleplay';
import { aiStatus } from '@/lib/training/ai';
import { getSettings } from '@/lib/training/settings';

export const dynamic = 'force-dynamic';

/** GET /api/training/roleplays — scenarios + my recent sessions (trainer: ?user_id=). */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const userId = resolveTargetUser(auth, new URL(request.url).searchParams.get('user_id'));
  const [scenarios, sessions, ai, settings] = await Promise.all([
    query(
      `SELECT id, code, title, objective, difficulty, exam_kind, pass_rule, objections_json,
              persona_json->>'firm_type' AS firm_type, persona_json->>'state' AS state, persona_json->>'mood' AS mood,
              (script_json ? 'start') AS has_script
       FROM training_roleplay_scenarios WHERE active ORDER BY exam_kind NULLS FIRST, code`
    ),
    query(
      `SELECT s.id, s.scenario_id, sc.code AS scenario_code, s.persona_json->>'title' AS title, s.mode, s.engine, s.purpose,
              s.final_score, s.status, s.human_reviewed, s.started_at, s.finished_at, s.duration_s
       FROM training_roleplay_sessions s LEFT JOIN training_roleplay_scenarios sc ON sc.id = s.scenario_id
       WHERE s.user_id = $1 ORDER BY s.started_at DESC LIMIT 50`,
      [userId]
    ),
    aiStatus(userId),
    getSettings(),
  ]);
  return ok({ scenarios, sessions, ai, voice_enabled: settings.voice_enabled && ai.available });
});

/**
 * POST /api/training/roleplays
 * { scenario_code | scenario_id | lead: 'random' | lead_id, purpose?, mode?: 'text'|'voice', lesson_id?, force_script? }
 */
export const POST = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const b = await readJson(request);
  const leadId = b.lead === 'random' ? 'random' : b.lead_id ? Number(b.lead_id) : undefined;
  return ok(await startSession(auth.userId, {
    scenarioCode: b.scenario_code, scenarioId: b.scenario_id ? Number(b.scenario_id) : undefined, leadId,
    purpose: ['practice', 'exam', 'daily'].includes(b.purpose) ? b.purpose : 'practice',
    mode: b.mode === 'voice' ? 'voice' : 'text', lessonId: b.lesson_id ? Number(b.lesson_id) : null, forceScript: !!b.force_script,
  }));
});
