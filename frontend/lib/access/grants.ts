/**
 * Scoped, expiring access ("grants") — the single source of extra access on top
 * of normal project membership.
 *
 *   project grant   read the whole project (+ comment if level ≥ comment); optional
 *                   Development secrets via scope.vault_envs. Never staging/production
 *                   unless scope.hr_approved. Used by help requests.
 *   ticket grant    that ticket only (its files and comments), never the project list.
 *   file / saved_view / vault_item grants   that one thing.
 *
 * A grant counts only while: not revoked, started, not expired, not waiting for HR
 * approval. Time is checked in SQL on every request, so expiry needs no job; the
 * hourly job (expireGrants) only marks, notifies and logs.
 */
import { query, queryOne } from '@/lib/db';

export type GrantLevel = 'view' | 'comment' | 'edit';
export type GrantResource = 'project' | 'ticket' | 'doc' | 'snippet' | 'file' | 'saved_view' | 'vault_item';

export interface Grant {
  id: number; grantee_id: number; resource_type: GrantResource; resource_id: string; project_id: number | null;
  level: GrantLevel; scope: { vault_envs?: string[]; hr_approved?: boolean; pending_approval?: boolean; [k: string]: unknown };
  reason: string | null; granted_by: number | null; source: 'help_request' | 'share' | 'guest';
  starts_at: string; expires_at: string | null; revoked_at: string | null; created_at: string;
}

const RANK: Record<GrantLevel, number> = { view: 0, comment: 1, edit: 2 };
export const levelAtLeast = (have: GrantLevel | null | undefined, need: GrantLevel) => !!have && RANK[have] >= RANK[need];

import { ACTIVE_GRANT } from './grant-sql';
export { ACTIVE_GRANT, projectGrantSql } from './grant-sql';

function norm(g: any): Grant {
  return { ...g, id: Number(g.id), grantee_id: Number(g.grantee_id), project_id: g.project_id == null ? null : Number(g.project_id),
    granted_by: g.granted_by == null ? null : Number(g.granted_by), scope: g.scope || {} };
}

/** The strongest active grant a user has on one resource (edit > comment > view). */
export async function activeGrant(userId: number, type: GrantResource, resourceId: string | number): Promise<Grant | null> {
  const g = await queryOne(
    `SELECT * FROM access_grants g
      WHERE g.grantee_id = $1 AND g.resource_type = $2 AND g.resource_id = $3 AND ${ACTIVE_GRANT('g')}
      ORDER BY CASE g.level WHEN 'edit' THEN 0 WHEN 'comment' THEN 1 ELSE 2 END, g.expires_at DESC NULLS FIRST LIMIT 1`,
    [userId, type, String(resourceId)]
  ).catch(() => null); // before the migration: no grants
  return g ? norm(g) : null;
}

/** All active grants of one kind a user holds inside a project (e.g. shared secrets). */
export async function activeGrantsIn(userId: number, type: GrantResource, projectId: number): Promise<Grant[]> {
  const rows = await query(
    `SELECT * FROM access_grants g WHERE g.grantee_id = $1 AND g.resource_type = $2 AND g.project_id = $3 AND ${ACTIVE_GRANT('g')}`,
    [userId, type, projectId]
  ).catch(() => []);
  return rows.map(norm);
}

export interface NewGrant {
  grantee_id: number; resource_type: GrantResource; resource_id: string | number; project_id: number | null;
  level: GrantLevel; scope?: Grant['scope']; reason?: string | null; granted_by: number | null;
  source: Grant['source']; expires_at: Date | null;
}

export async function createGrant(g: NewGrant): Promise<Grant> {
  const row = await queryOne(
    `INSERT INTO access_grants (grantee_id, resource_type, resource_id, project_id, level, scope, reason, granted_by, source, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10) RETURNING *`,
    [g.grantee_id, g.resource_type, String(g.resource_id), g.project_id, g.level, JSON.stringify(g.scope || {}),
      g.reason ?? null, g.granted_by, g.source, g.expires_at]
  );
  return norm(row);
}

export async function revokeGrant(id: number, by: number) {
  await query(`UPDATE access_grants SET revoked_at = NOW(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL`, [id, by]);
}

/** Development-only unless HR approved the grant for more. */
export function grantVaultEnvs(g: Grant | null): string[] {
  if (!g) return [];
  const envs = Array.isArray(g.scope.vault_envs) ? g.scope.vault_envs.map(String) : [];
  return g.scope.hr_approved ? envs : envs.filter((e) => e === 'development');
}

// ------------------------------------------------------------------ guests and availability

/** Is this user a guest (freelance) developer? */
export async function isGuest(userId: number): Promise<boolean> {
  const r = await queryOne<{ is_guest: boolean }>(`SELECT is_guest FROM developer_profiles WHERE user_id = $1`, [userId]).catch(() => null);
  return !!r?.is_guest;
}

/** A guest whose access window has passed can't use anything (checked on every request). */
export async function guestExpired(userId: number): Promise<boolean> {
  const r = await queryOne<{ expired: boolean }>(
    `SELECT (is_guest AND guest_expires_at IS NOT NULL AND guest_expires_at <= NOW()) AS expired FROM developer_profiles WHERE user_id = $1`,
    [userId]
  ).catch(() => null);
  return !!r?.expired;
}

/** SQL: user `u` is not out of office today and is not a guest — eligible for auto-picks. */
export const autoPickableSql = (u = 'u') =>
  `(NOT EXISTS (SELECT 1 FROM user_availability a WHERE a.user_id = ${u}.id
                 AND (NOW() AT TIME ZONE 'Asia/Karachi')::date BETWEEN a.starts_on AND a.ends_on)
    AND NOT EXISTS (SELECT 1 FROM developer_profiles dp WHERE dp.user_id = ${u}.id AND dp.is_guest))`;

export async function isOutOfOffice(userId: number): Promise<{ until: string; note: string | null } | null> {
  const r = await queryOne<{ until: string; note: string | null }>(
    `SELECT ends_on::text AS until, note FROM user_availability
      WHERE user_id = $1 AND (NOW() AT TIME ZONE 'Asia/Karachi')::date BETWEEN starts_on AND ends_on
      ORDER BY ends_on DESC LIMIT 1`, [userId]
  ).catch(() => null);
  return r;
}

/** Pick the next person after `last` in a stable (id) order. */
export function nextInRotation(ids: number[], last: number | null | undefined): number | null {
  if (!ids.length) return null;
  const sorted = [...ids].sort((a, b) => a - b);
  if (last == null) return sorted[0];
  return sorted.find((id) => id > last) ?? sorted[0];
}
