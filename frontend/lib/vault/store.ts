/**
 * Project Env storage: access check, per-project data keys, encrypt/decrypt,
 * and the audit trail. Plain values exist only in memory for the request that
 * needs them; they are never logged, put in errors, or sent to the thread.
 */
import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { getViewer, loadProject, normalizeProject, ProjectRow, Viewer } from '@/lib/projects/core';
import { activeGrantsIn, grantVaultEnvs } from '@/lib/access/grants';
import { canUseEnv, envAccessMap, isVaultEnv, VaultEnv } from './access';
import { masterKey, newDataKey, open, seal, secretAad, unwrapDataKey, VaultConfigError, wrapDataKey } from './crypto';

export const MAX_VALUE_BYTES = 64 * 1024;
export const MAX_IMPORT_ENTRIES = 500;

export interface VaultContext {
  viewer: Viewer;
  project: ProjectRow;
  memberRole: string | null;
  ip: string | null;
  userAgent: string | null;
  /** Environments opened by a help-request grant (Development only unless HR approved). Read-only. */
  grantEnvs: VaultEnv[];
  /** Single secrets shared with this user (vault_item grants) → grant id. Read-only. */
  sharedSecrets: Map<number, number>;
  /** The grant behind this access, recorded in vault_audit. */
  grantId: number | null;
  /** True when access comes only from grants: values can be read, nothing can be changed. */
  readOnly: boolean;
}

/** Viewer + project they can see + their member role. 403 for anyone with no Env access at all. */
export async function vaultContext(request: NextRequest, projectId: number): Promise<VaultContext> {
  const viewer = await getViewer(request);
  if (viewer.role === 'agent') throw new HttpError(403, 'Env is only available to the project’s developers and HR');
  // Writes are checked below (requireVaultWrite), so grant-only readers may reach POST value routes.
  let project: ProjectRow & { access?: { via: string; grant: any } };
  const items = await activeGrantsIn(viewer.userId, 'vault_item', projectId);
  try {
    project = await loadProject(projectId, viewer, { grantWrite: 'view' });
  } catch (e) {
    // Someone with only individual secrets shared with them.
    if (!items.length) throw e;
    const raw = await queryOne<ProjectRow>(`SELECT * FROM projects WHERE id = $1`, [projectId]);
    if (!raw) throw e;
    project = normalizeProject(raw);
  }
  const m = await queryOne<{ member_role: string }>(
    `SELECT member_role FROM project_members WHERE project_id = $1 AND user_id = $2`, [project.id, viewer.userId]
  );
  const memberRole = m?.member_role ?? null;
  const projectGrant = project.access?.via === 'grant' ? project.access.grant : null;
  const grantEnvs = grantVaultEnvs(projectGrant).filter(isVaultEnv) as VaultEnv[];
  // A shared production secret needs HR approval on the share; dev/staging don't.
  const shared = items.length ? await query<{ id: number; environment: VaultEnv }>(
    `SELECT id, environment FROM vault_secrets WHERE project_id = $1 AND id = ANY($2::int[])`,
    [project.id, items.map((g) => Number(g.resource_id))]
  ) : [];
  const sharedSecrets = new Map<number, number>();
  for (const sec of shared) {
    const g = items.find((x) => Number(x.resource_id) === sec.id)!;
    if (sec.environment !== 'production' || g.scope.hr_approved) sharedSecrets.set(sec.id, g.id);
  }
  const own = Object.values(envAccessMap(viewer.role, memberRole)).some(Boolean);
  if (!own && !grantEnvs.length && !sharedSecrets.size) {
    throw new HttpError(403, 'Env is only available to the project’s developers and HR');
  }
  // A CEO can cut anyone's Env access instantly (one project or all of them).
  if (viewer.realRole !== 'ceo') {
    const revoked = await queryOne(
      `SELECT 1 FROM vault_access_revocations WHERE user_id = $1 AND (project_id IS NULL OR project_id = $2) LIMIT 1`,
      [viewer.userId, project.id]
    ).catch(() => null);
    if (revoked) throw new HttpError(403, 'Your Env access has been revoked');
  }
  const fwd = request.headers.get('x-forwarded-for');
  return {
    viewer, project, memberRole,
    ip: (fwd ? fwd.split(',')[0].trim() : request.ip) || null,
    userAgent: request.headers.get('user-agent')?.slice(0, 500) || null,
    grantEnvs, sharedSecrets, grantId: own ? null : projectGrant?.id ?? null, readOnly: !own,
  };
}

/** Env access per environment: 'full' (by right or help grant), 'items' (only shared secrets), or none. */
export function envAccess(ctx: VaultContext, env: VaultEnv): 'full' | 'items' | null {
  if (canUseEnv(ctx.viewer.role, ctx.memberRole, env) || ctx.grantEnvs.includes(env)) return 'full';
  return ctx.sharedSecrets.size ? 'items' : null;
}

/** Anyone whose access comes only from grants can read but not change anything. */
export function requireVaultWrite(ctx: VaultContext) {
  if (ctx.readOnly) throw new HttpError(403, 'Your access to this Env is read-only');
}

export function requireEnv(ctx: VaultContext, env: unknown): VaultEnv {
  if (!isVaultEnv(env)) throw new HttpError(400, 'environment must be development, staging or production');
  if (!canUseEnv(ctx.viewer.role, ctx.memberRole, env) && !ctx.grantEnvs.includes(env)) {
    throw new HttpError(403, env === 'production'
      ? 'Production values are limited to HR and the project’s lead developer'
      : 'You don’t have access to this environment');
  }
  return env;
}

function master(): Buffer {
  try {
    return masterKey();
  } catch (err) {
    if (err instanceof VaultConfigError) throw new HttpError(503, 'Env vault is not configured on the server (VAULT_MASTER_KEY)');
    throw err;
  }
}

/** The project's data key, creating it on first use (race-safe). */
export async function projectDataKey(projectId: number): Promise<Buffer> {
  const mk = master();
  let row = await queryOne<{ enc_key: Buffer; iv: Buffer; tag: Buffer }>(
    `SELECT enc_key, iv, tag FROM vault_project_keys WHERE project_id = $1`, [projectId]
  );
  if (!row) {
    const w = wrapDataKey(newDataKey(), projectId, mk);
    await query(
      `INSERT INTO vault_project_keys (project_id, enc_key, iv, tag) VALUES ($1, $2, $3, $4) ON CONFLICT (project_id) DO NOTHING`,
      [projectId, w.ciphertext, w.iv, w.tag]
    );
    row = await queryOne(`SELECT enc_key, iv, tag FROM vault_project_keys WHERE project_id = $1`, [projectId]);
  }
  return unwrapDataKey({ ciphertext: row!.enc_key, iv: row!.iv, tag: row!.tag }, projectId, mk);
}

export function checkValue(value: unknown): string {
  if (typeof value !== 'string') throw new HttpError(400, 'Value must be text');
  if (Buffer.byteLength(value, 'utf8') > MAX_VALUE_BYTES) throw new HttpError(400, 'Value is larger than 64 KB');
  return value;
}

export interface SecretRow {
  id: number; project_id: number; environment: VaultEnv; key_name: string;
  ciphertext: Buffer; iv: Buffer; tag: Buffer; note: string | null;
}

export async function loadSecret(ctx: VaultContext, secretId: number): Promise<SecretRow> {
  const s = await queryOne<SecretRow>(
    `SELECT id, project_id, environment, key_name, ciphertext, iv, tag, note FROM vault_secrets WHERE id = $1 AND project_id = $2`,
    [secretId, ctx.project.id]
  );
  if (!s) throw new HttpError(404, 'Variable not found');
  if (envAccess(ctx, s.environment) !== 'full' && !ctx.sharedSecrets.has(s.id)) {
    if (!ctx.sharedSecrets.size) requireEnv(ctx, s.environment);
    throw new HttpError(404, 'Variable not found');
  }
  return s;
}

export function decryptSecret(dataKey: Buffer, s: SecretRow): string {
  return open(dataKey, { ciphertext: s.ciphertext, iv: s.iv, tag: s.tag }, secretAad(s.project_id, s.environment, s.key_name)).toString('utf8');
}

export function encryptValue(dataKey: Buffer, projectId: number, env: VaultEnv, keyName: string, value: string) {
  return seal(dataKey, value, secretAad(projectId, env, keyName));
}

/** Insert or overwrite one variable. Returns whether it was new. */
export async function upsertSecret(
  ctx: VaultContext, dataKey: Buffer, env: VaultEnv, keyName: string, value: string, note: string | null | undefined
): Promise<{ id: number; created: boolean }> {
  const s = encryptValue(dataKey, ctx.project.id, env, keyName, value);
  const row = await queryOne<{ id: number; created: boolean }>(
    `INSERT INTO vault_secrets (project_id, environment, key_name, ciphertext, iv, tag, note, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
     ON CONFLICT (project_id, environment, key_name) DO UPDATE
       SET ciphertext = EXCLUDED.ciphertext, iv = EXCLUDED.iv, tag = EXCLUDED.tag,
           note = COALESCE(EXCLUDED.note, vault_secrets.note), updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING id, (xmax = 0) AS created`,
    [ctx.project.id, env, keyName, s.ciphertext, s.iv, s.tag, note ?? null, ctx.viewer.userId]
  );
  return row!;
}

export type AuditAction = 'create' | 'update' | 'delete' | 'reveal' | 'copy' | 'download' | 'import' | 'break_glass' | 'share' | 'share_revoked' | 'share_approved';

export async function audit(
  ctx: VaultContext, action: AuditAction, env: VaultEnv | null, secret: { id: number; key_name: string } | null, reason: string | null = null
) {
  // Access through a grant (help request / share) names the grant in the audit.
  const grantId = (secret && ctx.sharedSecrets?.get(secret.id)) ?? ctx.grantId ?? null;
  await query(
    `INSERT INTO vault_audit (user_id, project_id, secret_id, key_name, environment, action, ip, user_agent, reason, grant_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [ctx.viewer.userId, ctx.project.id, secret?.id ?? null, secret?.key_name ?? null, env, action, ctx.ip, ctx.userAgent, reason, grantId]
  );
}

/**
 * Before any plain value leaves the server. Read-only "view as" never sees values.
 * A CEO must break the glass: a fresh authenticator code + a reason (headers
 * x-totp-code / x-break-glass-reason, or body totp_code / reason). It's logged in the
 * vault audit and the CEO access log, and the project's lead developer(s) are told.
 * Returns true when this was a break-glass access (the caller then skips its normal audit row).
 */
export async function guardValueAccess(
  ctx: VaultContext, request: NextRequest, what: string, env: VaultEnv, secret: { id: number; key_name: string } | null, body: any = {}
): Promise<boolean> {
  if (ctx.viewer.readonly) throw new HttpError(403, 'Values are hidden while viewing as someone else');
  if (ctx.viewer.realRole !== 'ceo') return false;
  const code = request.headers.get('x-totp-code') || body?.totp_code;
  const reason = String(request.headers.get('x-break-glass-reason') || body?.reason || '').trim();
  if (reason.length < 5) throw new HttpError(403, 'Break-glass: give a reason (at least 5 characters)');
  const { requireFreshCode, ceoTwoFactorRequired } = await import('@/lib/auth/twofactor');
  // With CEO 2FA switched off, a reason is enough; it's still logged and the lead is told.
  if (ceoTwoFactorRequired()) await requireFreshCode(ctx.viewer.userId, code);
  await audit(ctx, 'break_glass', env, secret, reason);
  const { logCeoAccess } = await import('@/lib/auth/ceo');
  await logCeoAccess(ctx.viewer.userId, 'vault_reveal', `${ctx.project.ticket_no} ${env} ${what}`, reason, request);
  const leads = await query<{ user_id: string }>(
    `SELECT user_id FROM project_members WHERE project_id = $1 AND member_role = 'lead_developer'`, [ctx.project.id]
  );
  const { notify } = await import('@/lib/notifications');
  await notify({
    users: leads.map((l) => Number(l.user_id)), actorId: ctx.viewer.userId, type: 'vault_break_glass',
    body: `${ctx.viewer.name} (CEO) revealed ${what} in ${ctx.project.ticket_no} ${env}. Reason: ${reason}`,
    link: `/projects/${ctx.project.id}?tab=env`, projectId: ctx.project.id,
  });
  return true;
}
