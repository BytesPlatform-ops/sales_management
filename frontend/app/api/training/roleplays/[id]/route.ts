import { NextRequest } from 'next/server';
import { getAuth, handler, ok } from '@/lib/training/http';
import { getScenario, loadOwnSession, publicSession } from '@/lib/training/roleplay';

export const dynamic = 'force-dynamic';

/** GET /api/training/roleplays/{id} — session with transcript, scores and (script engine) the current choices. */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const auth = await getAuth(request);
  const s = await loadOwnSession(Number(params.id), auth.userId, auth.role === 'hr');
  let script_view = null;
  if (s.engine === 'script' && s.status === 'active' && s.scenario_id) {
    const sc = await getScenario(s.scenario_id);
    const node = sc?.script_json?.nodes?.[s.state_json?.node];
    if (node) {
      script_view = {
        node_id: s.state_json.node, prospect: node.prospect, end: !!node.end, outcome: node.outcome || null,
        choices: (node.choices || []).map((c, i) => ({ index: i, label: c.label })),
      };
    }
  }
  return ok({ session: publicSession(s), script_view, done: !!s.state_json?.done, trainer_comment: (s as any).trainer_comment || null });
});
