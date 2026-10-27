/**
 * Repo access follows the project: we work out who SHOULD have access and fix
 * GitHub to match (adding and removing), remembering what we granted in repo_access.
 *
 *   push  developers / lead developers on the project (not expired guests)
 *   pull  people with an active project-level grant (help requests) — read only
 *
 * Only developers with a linked GitHub account can be added. Called on member
 * add/remove, help accept/extend/cancel, and hourly (grant expiry, guest expiry).
 */
import { query } from '@/lib/db';
import { ACTIVE_GRANT } from '@/lib/access/grants';
import { github } from './client';

export interface AccessChange { added: string[]; removed: string[]; errors: string[] }

export async function desiredRepoAccess(projectId: number): Promise<Map<number, { login: string; permission: 'push' | 'pull' }>> {
  const members = await query<{ user_id: string; github_login: string }>(
    `SELECT m.user_id, g.github_login FROM project_members m
       JOIN users u ON u.id = m.user_id AND u.role = 'developer' AND COALESCE(u.is_active, true)
       JOIN developer_github g ON g.user_id = m.user_id
       LEFT JOIN developer_profiles dp ON dp.user_id = m.user_id
      WHERE m.project_id = $1 AND m.member_role IN ('developer', 'lead_developer')
        AND NOT (COALESCE(dp.is_guest, false) AND dp.guest_expires_at IS NOT NULL AND dp.guest_expires_at <= NOW())`,
    [projectId]
  );
  const helpers = await query<{ user_id: string; github_login: string }>(
    `SELECT DISTINCT ag.grantee_id AS user_id, g.github_login FROM access_grants ag
       JOIN developer_github g ON g.user_id = ag.grantee_id
       JOIN users u ON u.id = ag.grantee_id AND COALESCE(u.is_active, true)
      WHERE ag.resource_type = 'project' AND ag.resource_id = $1::text AND ${ACTIVE_GRANT('ag')}`,
    [projectId]
  );
  const want = new Map<number, { login: string; permission: 'push' | 'pull' }>();
  for (const h of helpers) want.set(Number(h.user_id), { login: h.github_login, permission: 'pull' });
  for (const m of members) want.set(Number(m.user_id), { login: m.github_login, permission: 'push' });
  return want;
}

/** Make the repo's collaborators match the project. No-op when the project has no repo. */
export async function syncRepoAccess(projectId: number): Promise<AccessChange> {
  const change: AccessChange = { added: [], removed: [], errors: [] };
  const [repo] = await query<{ full_name: string }>(`SELECT full_name FROM project_repos WHERE project_id = $1`, [projectId]);
  if (!repo || !github().configured()) return change;
  const want = await desiredRepoAccess(projectId);
  const have = await query<{ user_id: string; github_login: string; permission: 'push' | 'pull' }>(
    `SELECT user_id, github_login, permission FROM repo_access WHERE project_id = $1`, [projectId]
  );
  for (const h of have) {
    const w = want.get(Number(h.user_id));
    if (w && w.login.toLowerCase() === h.github_login.toLowerCase() && w.permission === h.permission) continue;
    if (!w || w.login.toLowerCase() !== h.github_login.toLowerCase()) {
      try {
        await github().removeCollaborator(repo.full_name, h.github_login);
        await query(`DELETE FROM repo_access WHERE project_id = $1 AND user_id = $2`, [projectId, Number(h.user_id)]);
        change.removed.push(h.github_login);
      } catch (e) { change.errors.push(`${h.github_login}: ${(e as Error).message}`); }
    }
  }
  const current = new Map((await query<{ user_id: string; github_login: string; permission: string }>(
    `SELECT user_id, github_login, permission FROM repo_access WHERE project_id = $1`, [projectId]
  )).map((r) => [Number(r.user_id), r]));
  for (const [userId, w] of Array.from(want.entries())) {
    const c = current.get(userId);
    if (c && c.github_login.toLowerCase() === w.login.toLowerCase() && c.permission === w.permission) continue;
    try {
      await github().addCollaborator(repo.full_name, w.login, w.permission);
      await query(
        `INSERT INTO repo_access (project_id, user_id, github_login, permission) VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, user_id) DO UPDATE SET github_login = EXCLUDED.github_login, permission = EXCLUDED.permission, granted_at = NOW()`,
        [projectId, userId, w.login, w.permission]
      );
      change.added.push(`${w.login}:${w.permission}`);
    } catch (e) { change.errors.push(`${w.login}: ${(e as Error).message}`); }
  }
  if (change.errors.length) console.error('[github] repo access', projectId, change.errors.join('; '));
  return change;
}

/** Fire-and-forget from request handlers: GitHub being slow or down never fails the action. */
export function syncRepoAccessSoon(projectId: number) {
  syncRepoAccess(projectId).catch((e) => console.error('[github] repo access', projectId, (e as Error).message));
}

/** Hourly: every project with a repo (expired grants and guests drop out). */
export async function syncAllRepoAccess(): Promise<number> {
  const repos = await query<{ project_id: number }>(`SELECT project_id FROM project_repos`);
  for (const r of repos) await syncRepoAccess(r.project_id);
  return repos.length;
}
