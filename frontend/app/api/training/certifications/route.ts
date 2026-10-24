import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { getAuth, handler, ok } from '@/lib/training/http';
import { buildPath, evaluateRule, loadGates, loadCatalog, loadUserState } from '@/lib/training/progress';

export const dynamic = 'force-dynamic';

/**
 * GET /api/training/certifications?user_id= — a rep's certifications + live requirement checklist.
 * Trainer without user_id: every rep's certifications.
 */
export const GET = handler(async (request: NextRequest) => {
  const auth = await getAuth(request);
  const param = new URL(request.url).searchParams.get('user_id');

  if (auth.role === 'hr' && !param) {
    return ok(await query(
      `SELECT c.id, c.code, c.user_id, u.full_name, c.granted_at, c.method, g.full_name AS granted_by_name, c.revoked_at, c.notes
       FROM training_certifications c JOIN users u ON u.id = c.user_id LEFT JOIN users g ON g.id = c.granted_by
       ORDER BY c.granted_at DESC LIMIT 500`
    ));
  }

  const userId = auth.role === 'hr' && param ? Number(param) : auth.userId;
  const [certs, gates, catalog, state] = await Promise.all([
    query(`SELECT id, code, granted_at, method, granted_by, expires_at, revoked_at, notes FROM training_certifications WHERE user_id = $1 ORDER BY granted_at`, [userId]),
    loadGates(), loadCatalog(), loadUserState(userId),
  ]);
  const requirements = Array.from(gates.values())
    .filter((g) => g.target_type === 'cert')
    .map((g) => ({ code: g.code, description: g.description, earned: state.certs.has(g.code), ...evaluateRule(g.rule_json, state, catalog) }));
  void buildPath;
  return ok({ user_id: userId, certifications: certs, requirements });
});
