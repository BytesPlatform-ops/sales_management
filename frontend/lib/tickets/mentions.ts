/**
 * @mentions in ticket comments: "@ali" or "@ali_dev" (usernames). Only people who
 * can see the project are notified: HR, its members, and the agent who opened it.
 */
import { query } from '@/lib/db';
import { ACTIVE_GRANT } from '@/lib/access/grant-sql';

export function mentionedUsernames(body: string): string[] {
  const out = new Set<string>();
  const re = /(?:^|[\s(])@([A-Za-z0-9_.-]{2,50})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.add(m[1].toLowerCase());
  return Array.from(out);
}

export async function mentionedUserIds(projectId: number, body: string): Promise<number[]> {
  const names = mentionedUsernames(body);
  if (!names.length) return [];
  const rows = await query<{ id: string }>(
    `SELECT u.id FROM users u
      WHERE LOWER(u.username) = ANY($2::text[]) AND COALESCE(u.is_active, true)
        AND (u.role = 'hr'
             OR EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $1 AND m.user_id = u.id)
             OR EXISTS (SELECT 1 FROM projects p WHERE p.id = $1 AND p.created_by = u.id)
             OR EXISTS (SELECT 1 FROM access_grants g WHERE g.grantee_id = u.id AND g.resource_type = 'project'
                         AND g.resource_id = $1::text AND ${ACTIVE_GRANT('g')}))`,
    [projectId, names]
  );
  return rows.map((r) => Number(r.id));
}
