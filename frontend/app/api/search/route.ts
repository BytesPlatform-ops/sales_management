import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer, visibilityClause } from '@/lib/projects/core';
import { parseSearch } from '@/lib/search/query';
import { runSearch } from '@/lib/search/sources';
import { pktDate } from '@/lib/notifications-daily';

export const dynamic = 'force-dynamic';

/**
 * GET /api/search?q=&limit=
 * Everything the viewer can see that matches, grouped by kind. A ticket key on its
 * own ("PRJ-0012-T5") also returns `jump` so the palette can open it directly.
 * Syntax: see lib/search/query.ts.
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const sp = new URL(request.url).searchParams;
  const raw = (sp.get('q') || '').trim();
  const limit = Math.min(Math.max(Number(sp.get('limit')) || 8, 1), 50);
  if (!raw) return ok({ groups: [], jump: null });
  const q = parseSearch(raw, pktDate());

  let jump: string | null = null;
  if (q.key) {
    const t = await queryOne<{ key: string; project_id: number }>(
      `SELECT t.key, t.project_id FROM tickets t JOIN projects p ON p.id = t.project_id
        WHERE t.key = $2 AND t.deleted_at IS NULL AND ${visibilityClause(v, 'p')}`,
      [v.userId, q.key]
    );
    if (t) jump = `/projects/${t.project_id}/tickets/${t.key}`;
  }
  return ok({ groups: await runSearch(v, q, limit), jump, parsed: { ...q, text: q.text } });
});
