import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { chatViewer, fail, isSalesLead, isSalesRole, ok } from '@/lib/chat/core';

export const dynamic = 'force-dynamic';

/**
 * GET /api/chat/people — who I can start a DM or group with: everyone in sales
 * and HR; HR and sales leads also see developers.
 */
export async function GET(request: NextRequest) {
  try {
    const v = await chatViewer(request);
    if (!isSalesRole(v.role)) return ok([]);
    const withDevs = v.role === 'hr' || (await isSalesLead(v.userId));
    const rows = await query<{ id: string; full_name: string; role: string }>(
      `SELECT id, full_name, role FROM users
        WHERE is_active = true AND id <> $1 AND role = ANY($2::text[])
        ORDER BY full_name`,
      [v.userId, withDevs ? ['agent', 'hr', 'developer'] : ['agent', 'hr']]
    );
    return ok(rows.map((r) => ({ id: Number(r.id), name: r.full_name, role: r.role })));
  } catch (err) {
    return fail(err);
  }
}
