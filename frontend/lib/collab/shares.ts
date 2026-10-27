/**
 * Sharing one thing with one developer: a scoped access grant (view or edit, optional
 * expiry). You can only share what you can see, and only at a level you have
 * yourself. Vault items follow vault rules: Development/Staging can be shared; a
 * Production secret needs HR (a share made by HR is approved; anyone else's waits
 * for HR approval and gives nothing until then). Vault shares are written to the
 * vault audit.
 *
 * Docs and snippets (Phase 9) plug in here by adding a resolver to `resolveForGrantor`.
 */
import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import type { Viewer } from '@/lib/projects/core';
import { createGrant, Grant, GrantLevel, revokeGrant } from '@/lib/access/grants';
import { notify } from '@/lib/notifications';

export const SHAREABLE = ['ticket', 'file', 'saved_view', 'vault_item'] as const;
export type Shareable = (typeof SHAREABLE)[number];

interface Resolved { projectId: number | null; label: string; link: string; maxLevel: GrantLevel; vault?: { env: string; key: string } }

/** What the grantor may share, checked with the grantor's own access. */
export async function resolveForGrantor(request: NextRequest, type: Shareable, resourceId: string): Promise<Resolved> {
  if (type === 'ticket') {
    const { ticketCtx, capabilities } = await import('@/lib/tickets/core');
    const ctx = await ticketCtx(request, Number(resourceId));
    const can = capabilities(ctx);
    // Sharing on from a share or help access isn't allowed: only people with their own access share.
    if (ctx.actor.grantLevel) throw new HttpError(403, 'You can’t re-share something that was shared with you');
    return { projectId: ctx.project.id, label: `${ctx.ticket.key} ${ctx.ticket.title}`, link: `/projects/${ctx.project.id}/tickets/${ctx.ticket.key}`, maxLevel: can.edit ? 'edit' : 'view' };
  }
  if (type === 'file') {
    const { loadMedia } = await import('@/lib/media/access');
    const { media, project } = await loadMedia(request, resourceId);
    if ((project as any).access?.via !== 'own') throw new HttpError(403, 'You can’t re-share something that was shared with you');
    return { projectId: media.project_id, label: media.file_name, link: `/projects/${media.project_id}?tab=files`, maxLevel: 'view' };
  }
  if (type === 'saved_view') {
    const { getViewer, loadProject } = await import('@/lib/projects/core');
    const { canEditView, canSeeView } = await import('@/lib/saved-views');
    const v = await getViewer(request);
    const row = await queryOne<any>(`SELECT id, owner_id, scope, project_id, name, view_type FROM saved_views WHERE id = $1`, [Number(resourceId)]);
    if (!row) throw new HttpError(404, 'View not found');
    const seeProject = row.project_id == null ? true : await loadProject(row.project_id, { ...v, method: 'GET' }).then(() => true, () => false);
    if (!canSeeView(v, row, seeProject)) throw new HttpError(404, 'View not found');
    const { viewHref } = await import('@/lib/saved-views');
    return { projectId: row.project_id, label: row.name, link: viewHref(row), maxLevel: canEditView(v, row) ? 'edit' : 'view' };
  }
  // vault_item: the grantor must be able to read the value with their own access.
  const sec = await queryOne<{ id: number; project_id: number; environment: string; key_name: string }>(
    `SELECT id, project_id, environment, key_name FROM vault_secrets WHERE id = $1`, [Number(resourceId)]
  );
  if (!sec) throw new HttpError(404, 'Variable not found');
  const { vaultContext, loadSecret } = await import('@/lib/vault/store');
  const vctx = await vaultContext(request, sec.project_id);
  if (vctx.readOnly) throw new HttpError(403, 'You can’t re-share something that was shared with you');
  await loadSecret(vctx, sec.id);
  return { projectId: sec.project_id, label: `${sec.key_name} (${sec.environment})`, link: `/projects/${sec.project_id}?tab=env`, maxLevel: 'view', vault: { env: sec.environment, key: sec.key_name } };
}

export async function createShare(request: NextRequest, viewer: Viewer, b: Record<string, unknown>) {
  const type = String(b.resource_type) as Shareable;
  if (!(SHAREABLE as readonly string[]).includes(type)) throw new HttpError(400, 'You can share a ticket, file, saved view or Env variable');
  const resourceId = String(b.resource_id ?? '');
  if (!resourceId) throw new HttpError(400, 'resource_id is required');
  const granteeId = Number(b.grantee_id);
  const grantee = await queryOne<{ id: string; full_name: string; role: string; is_active: boolean | null }>(
    `SELECT id, full_name, role, is_active FROM users WHERE id = $1`, [granteeId]
  );
  if (!grantee || grantee.is_active === false || grantee.role !== 'developer') throw new HttpError(400, 'You can share with an active developer');
  if (granteeId === viewer.userId) throw new HttpError(400, 'That’s you');
  const level = (['view', 'comment', 'edit'].includes(String(b.level)) ? String(b.level) : 'view') as GrantLevel;

  const r = await resolveForGrantor(request, type, resourceId);
  const rank = { view: 0, comment: 1, edit: 2 } as const;
  if (rank[level] > rank[r.maxLevel]) throw new HttpError(403, `You can share this at most as "${r.maxLevel}"`);

  let expires: Date | null = null;
  if (b.expires_at) {
    expires = new Date(String(b.expires_at));
    if (Number.isNaN(expires.getTime()) || expires.getTime() <= Date.now()) throw new HttpError(400, 'Expiry must be in the future');
  }
  const scope: Grant['scope'] = {};
  if (r.vault?.env === 'production') {
    if (viewer.role === 'hr') scope.hr_approved = true;
    else scope.pending_approval = true;
  }
  const g = await createGrant({
    grantee_id: granteeId, resource_type: type, resource_id: resourceId, project_id: r.projectId, level, scope,
    reason: b.note ? String(b.note).slice(0, 500) : null, granted_by: viewer.userId, source: 'share', expires_at: expires,
  });
  if (r.vault) await vaultAudit(viewer, r.projectId!, Number(resourceId), r.vault, 'share', g.id);
  if (scope.pending_approval) {
    const hr = await query<{ id: string }>(`SELECT id FROM users WHERE role = 'hr' AND COALESCE(is_active, true)`);
    await notify({ users: hr.map((h) => Number(h.id)), actorId: viewer.userId, type: 'share_approval',
      body: `${viewer.name} wants to share Production ${r.label} with ${grantee.full_name} — approve or ignore`, link: '/shared?tab=approvals', projectId: r.projectId });
  } else {
    await notify({ users: [granteeId], actorId: viewer.userId, type: 'share',
      body: `${viewer.name} shared ${r.label} with you${expires ? ` until ${expires.toISOString().slice(0, 10)}` : ''}`, link: r.link, projectId: r.projectId });
  }
  return { ...g, label: r.label, link: r.link };
}

async function vaultAudit(viewer: Viewer, projectId: number, secretId: number, v: { env: string; key: string }, action: string, grantId: number) {
  await query(
    `INSERT INTO vault_audit (user_id, project_id, secret_id, key_name, environment, action, grant_id) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [viewer.userId, projectId, secretId, v.key, v.env, action, grantId]
  );
}

export async function loadGrant(id: number): Promise<Grant> {
  const g = await queryOne<any>(`SELECT * FROM access_grants WHERE id = $1`, [id]);
  if (!g) throw new HttpError(404, 'Share not found');
  return { ...g, id: Number(g.id), grantee_id: Number(g.grantee_id), granted_by: g.granted_by == null ? null : Number(g.granted_by), project_id: g.project_id == null ? null : Number(g.project_id) };
}

export async function revokeShare(viewer: Viewer, g: Grant) {
  if (g.granted_by !== viewer.userId && viewer.role !== 'hr' && g.grantee_id !== viewer.userId) {
    throw new HttpError(403, 'Only the person who shared it, the recipient or HR can end this');
  }
  await revokeGrant(g.id, viewer.userId);
  if (g.resource_type === 'vault_item') {
    const sec = await queryOne<{ environment: string; key_name: string }>(`SELECT environment, key_name FROM vault_secrets WHERE id = $1`, [Number(g.resource_id)]);
    if (sec && g.project_id) await vaultAudit(viewer, g.project_id, Number(g.resource_id), { env: sec.environment, key: sec.key_name }, 'share_revoked', g.id);
  }
  // A help-request grant ending early closes the request too.
  if (g.source === 'help_request') {
    await query(`UPDATE help_requests SET status = 'cancelled', updated_at = NOW() WHERE grant_id = $1 AND status = 'accepted'`, [g.id]);
  }
  if (g.grantee_id !== viewer.userId) {
    await notify({ users: [g.grantee_id], actorId: viewer.userId, type: 'share_revoked', body: `${viewer.name} ended your access to a shared ${g.resource_type.replace('_', ' ')}`, link: '/shared' });
  }
}

export async function approveShare(viewer: Viewer, g: Grant) {
  if (viewer.role !== 'hr') throw new HttpError(403, 'Only HR can approve Production shares');
  if (!g.scope?.pending_approval) return;
  await query(
    `UPDATE access_grants SET scope = (scope - 'pending_approval') || '{"hr_approved": true}'::jsonb WHERE id = $1`, [g.id]
  );
  const sec = await queryOne<{ environment: string; key_name: string }>(`SELECT environment, key_name FROM vault_secrets WHERE id = $1`, [Number(g.resource_id)]);
  if (sec && g.project_id) await vaultAudit(viewer, g.project_id, Number(g.resource_id), { env: sec.environment, key: sec.key_name }, 'share_approved', g.id);
  await notify({ users: [g.grantee_id], actorId: viewer.userId, type: 'share', body: `HR approved access to ${sec?.key_name ?? 'a Production variable'}`, link: g.project_id ? `/projects/${g.project_id}?tab=env` : '/shared' });
}

/** Human labels + links for a list of grants (for "Shared with me" / "Shared by me"). */
export async function describeGrants(grants: any[]) {
  return Promise.all(grants.map(async (g) => {
    let label = `${g.resource_type} #${g.resource_id}`;
    let link = '/shared';
    try {
      if (g.resource_type === 'project') {
        const p = await queryOne<{ ticket_no: string; title: string }>(`SELECT ticket_no, title FROM projects WHERE id = $1`, [Number(g.resource_id)]);
        if (p) { label = `${p.ticket_no} ${p.title}`; link = `/projects/${g.resource_id}`; }
      } else if (g.resource_type === 'ticket') {
        const t = await queryOne<{ key: string; title: string; project_id: number }>(`SELECT key, title, project_id FROM tickets WHERE id = $1`, [Number(g.resource_id)]);
        if (t) { label = `${t.key} ${t.title}`; link = `/projects/${t.project_id}/tickets/${t.key}`; }
      } else if (g.resource_type === 'file') {
        const f = await queryOne<{ file_name: string; project_id: number }>(`SELECT file_name, project_id FROM media_files WHERE id = $1`, [g.resource_id]);
        if (f) { label = f.file_name; link = `/projects/${f.project_id}?tab=files`; }
      } else if (g.resource_type === 'saved_view') {
        const v = await queryOne<{ id: number; name: string; project_id: number | null; view_type: string }>(`SELECT id, name, project_id, view_type FROM saved_views WHERE id = $1`, [Number(g.resource_id)]);
        if (v) { const { viewHref } = await import('@/lib/saved-views'); label = v.name; link = viewHref(v); }
      } else if (g.resource_type === 'vault_item') {
        const s = await queryOne<{ key_name: string; environment: string; project_id: number }>(`SELECT key_name, environment, project_id FROM vault_secrets WHERE id = $1`, [Number(g.resource_id)]);
        if (s) { label = `${s.key_name} (${s.environment})`; link = `/projects/${s.project_id}?tab=env`; }
      }
    } catch { /* keep the generic label */ }
    return { ...g, label, link };
  }));
}
