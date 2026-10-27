import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, requireHr } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

const ACTIONS = ['create', 'update', 'delete', 'reveal', 'copy', 'download', 'import'];

/** GET /api/hr/vault-audit?project_id=&user_id=&action=&limit= — who touched which Env variable. HR only. */
export const GET = handler(async (request: NextRequest) => {
  await requireHr(request);
  const sp = new URL(request.url).searchParams;
  const where: string[] = [];
  const params: any[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (sp.get('project_id')) add('a.project_id = ?', Number(sp.get('project_id')));
  if (sp.get('user_id')) add('a.user_id = ?', Number(sp.get('user_id')));
  if (sp.get('action') && ACTIONS.includes(sp.get('action')!)) add('a.action = ?', sp.get('action'));
  params.push(Math.min(Math.max(Number(sp.get('limit')) || 100, 1), 500));
  return ok(await query(
    `SELECT a.id, a.action, a.environment, a.key_name, a.ip, a.created_at,
            a.project_id, p.ticket_no, a.user_id, u.full_name AS user_name, u.role AS user_role
       FROM vault_audit a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN projects p ON p.id = a.project_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY a.created_at DESC
      LIMIT $${params.length}`,
    params
  ));
});
