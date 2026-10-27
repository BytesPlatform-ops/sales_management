/**
 * Help requests: a developer asks for help on a ticket; a helper who accepts gets
 * TEMPORARY access through an access grant (lib/access/grants):
 *   project read + comment, Development secrets only, for 3 days by default.
 * The project lead or HR can extend it; it ends by itself (time is checked on
 * every request; the hourly job only marks it expired and tells people).
 *
 * Hooks for later phases:
 *   - GitHub: give the helper read access to the project repo on accept, remove on expiry.
 *   - Time tracking: a helper's logged time counts on the ticket (grantee may log time).
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { createGrant, revokeGrant, autoPickableSql } from '@/lib/access/grants';
import { notify, recordHistory, ticketLink, watch } from '@/lib/tickets/core';
import type { TicketCtx } from '@/lib/tickets/core';
import type { Viewer } from '@/lib/projects/core';
import { syncRepoAccessSoon } from '@/lib/github/access';

export const DEFAULT_HELP_DAYS = 3;
export const MAX_HELP_DAYS = 14;

export interface HelpRequest {
  id: number; ticket_id: number; project_id: number; requested_by: number; skills: string[]; target_user_ids: number[];
  message: string; status: 'open' | 'accepted' | 'declined' | 'cancelled' | 'expired'; accepted_by: number | null;
  accepted_at: string | null; grant_id: number | null; expires_at: string | null; extended_by: number | null;
  declined_by: number[]; created_at: string; updated_at: string;
}

const norm = (r: any): HelpRequest => ({
  ...r, requested_by: Number(r.requested_by), accepted_by: r.accepted_by == null ? null : Number(r.accepted_by),
  target_user_ids: (r.target_user_ids || []).map(Number), declined_by: (r.declined_by || []).map(Number),
  extended_by: r.extended_by == null ? null : Number(r.extended_by),
});

export const cleanSkills = (v: unknown): string[] =>
  Array.from(new Set((Array.isArray(v) ? v : []).map((s) => String(s).trim().toLowerCase().slice(0, 40)).filter(Boolean))).slice(0, 10);

export function helpDays(v: unknown): number {
  const n = v === undefined || v === null || v === '' ? DEFAULT_HELP_DAYS : Math.round(Number(v));
  if (!Number.isFinite(n) || n < 1 || n > MAX_HELP_DAYS) throw new HttpError(400, `Access can last 1–${MAX_HELP_DAYS} days`);
  return n;
}

/**
 * Who gets asked: the named developers, else active developers whose skills overlap.
 * Skill matching never picks guests, people out of office, or the requester.
 */
export async function helpCandidates(requesterId: number, skills: string[], targetIds: number[]): Promise<number[]> {
  if (targetIds.length) {
    const rows = await query<{ id: string }>(
      `SELECT id FROM users WHERE id = ANY($1::bigint[]) AND role = 'developer' AND COALESCE(is_active, true) AND id <> $2`,
      [targetIds, requesterId]
    );
    if (rows.length !== new Set(targetIds.filter((id) => id !== requesterId)).size) throw new HttpError(400, 'You can only ask active developers');
    return rows.map((r) => Number(r.id));
  }
  if (!skills.length) throw new HttpError(400, 'Pick skills or specific developers to ask');
  const rows = await query<{ id: string }>(
    `SELECT u.id FROM users u JOIN developer_profiles dp ON dp.user_id = u.id
      WHERE u.role = 'developer' AND COALESCE(u.is_active, true) AND u.id <> $1 AND dp.skills && $2::text[] AND ${autoPickableSql('u')}
      ORDER BY u.id`,
    [requesterId, skills]
  );
  return rows.map((r) => Number(r.id));
}

export async function loadHelp(id: number): Promise<HelpRequest> {
  const r = await queryOne(`SELECT * FROM help_requests WHERE id = $1`, [id]);
  if (!r) throw new HttpError(404, 'Help request not found');
  return norm(r);
}

export async function createHelpRequest(ctx: TicketCtx, b: { skills?: unknown; user_ids?: unknown; message?: unknown }) {
  const { ticket: t, viewer, project } = ctx;
  const message = String(b.message ?? '').trim().slice(0, 2000);
  if (!message) throw new HttpError(400, 'Say what you need help with');
  const skills = cleanSkills(b.skills);
  const targets = Array.from(new Set((Array.isArray(b.user_ids) ? b.user_ids : []).map(Number).filter(Number.isFinite)));
  const candidates = await helpCandidates(viewer.userId, skills, targets);
  if (!candidates.length) throw new HttpError(400, 'Nobody matches those skills right now — pick developers by name');
  const row = norm(await queryOne(
    `INSERT INTO help_requests (ticket_id, project_id, requested_by, skills, target_user_ids, message)
     VALUES ($1, $2, $3, $4::text[], $5::bigint[], $6) RETURNING *`,
    [t.id, project.id, viewer.userId, skills, targets.length ? candidates : [], message]
  ));
  await recordHistory(t.id, viewer.userId, 'help_requested', null, { help_request_id: row.id, skills, asked: candidates.length });
  await notify(candidates, viewer.userId, 'help_request',
    `${viewer.name} asked for help on ${t.key}: ${message.slice(0, 140)}`, `/help?request=${row.id}`);
  return { ...row, asked: candidates };
}

/** Can this developer answer the request? Named targets only; otherwise any non-guest developer with a matching skill (or any, with no skills given). */
export async function canAnswer(h: HelpRequest, userId: number): Promise<boolean> {
  if (h.requested_by === userId) return false;
  if (h.target_user_ids.length) return h.target_user_ids.includes(userId);
  const r = await queryOne(
    `SELECT 1 FROM users u LEFT JOIN developer_profiles dp ON dp.user_id = u.id
      WHERE u.id = $1 AND u.role = 'developer' AND COALESCE(u.is_active, true) AND NOT COALESCE(dp.is_guest, false)
        AND (cardinality($2::text[]) = 0 OR dp.skills && $2::text[])`,
    [userId, h.skills]
  );
  return !!r;
}

export async function acceptHelp(h: HelpRequest, viewer: Viewer, daysIn?: unknown) {
  if (h.status !== 'open') throw new HttpError(400, 'This request is no longer open');
  if (viewer.role !== 'developer' || !(await canAnswer(h, viewer.userId))) throw new HttpError(403, 'This request isn’t for you');
  const days = helpDays(daysIn);
  const expires = new Date(Date.now() + days * 86_400_000);
  const t = await queryOne<{ key: string; title: string }>(`SELECT key, title FROM tickets WHERE id = $1`, [h.ticket_id]);
  // Project members already have access; everyone else gets a temporary grant.
  const member = await queryOne(`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2`, [h.project_id, viewer.userId]);
  let grantId: number | null = null;
  if (!member) {
    const g = await createGrant({
      grantee_id: viewer.userId, resource_type: 'project', resource_id: h.project_id, project_id: h.project_id,
      level: 'comment', scope: { vault_envs: ['development'], ticket_id: h.ticket_id }, reason: `Helping on ${t?.key}`,
      granted_by: h.requested_by, source: 'help_request', expires_at: expires,
    });
    grantId = g.id;
  }
  const claimed = await queryOne(
    `UPDATE help_requests SET status = 'accepted', accepted_by = $2, accepted_at = NOW(), grant_id = $3, expires_at = $4, updated_at = NOW()
      WHERE id = $1 AND status = 'open' RETURNING id`,
    [h.id, viewer.userId, grantId, expires]
  );
  if (!claimed) {
    if (grantId) await revokeGrant(grantId, viewer.userId);
    throw new HttpError(409, 'Someone else just accepted this request');
  }
  await watch(h.ticket_id, [viewer.userId], 'manual');
  await recordHistory(h.ticket_id, viewer.userId, 'help_accepted', null, { help_request_id: h.id, until: expires.toISOString() });
  await notify([h.requested_by], viewer.userId, 'help_accepted',
    `${viewer.name} is helping on ${t?.key} until ${expires.toISOString().slice(0, 10)}`, ticketLink(h.project_id, t?.key || ''));
  if (grantId) syncRepoAccessSoon(h.project_id); // helper gets read access to the repo for the grant period
  return { status: 'accepted', grant_id: grantId, expires_at: expires.toISOString() };
}

export async function extendHelp(h: HelpRequest, viewer: Viewer, daysIn?: unknown) {
  if (h.status !== 'accepted') throw new HttpError(400, 'Only accepted requests can be extended');
  const lead = await queryOne(
    `SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND member_role = 'lead_developer'`, [h.project_id, viewer.userId]
  );
  if (viewer.role !== 'hr' && !lead) throw new HttpError(403, 'Only the lead developer or HR can extend access');
  const days = helpDays(daysIn);
  const from = Math.max(Date.now(), h.expires_at ? new Date(h.expires_at).getTime() : 0);
  const expires = new Date(from + days * 86_400_000);
  if (h.grant_id) await query(`UPDATE access_grants SET expires_at = $2, expired_notified_at = NULL WHERE id = $1 AND revoked_at IS NULL`, [h.grant_id, expires]);
  await query(`UPDATE help_requests SET expires_at = $2, extended_by = $3, updated_at = NOW() WHERE id = $1`, [h.id, expires, viewer.userId]);
  await recordHistory(h.ticket_id, viewer.userId, 'help_extended', h.expires_at, expires.toISOString());
  if (h.accepted_by) {
    await notify([h.accepted_by], viewer.userId, 'help_extended', `${viewer.name} extended your access until ${expires.toISOString().slice(0, 10)}`, `/shared`);
  }
  return { expires_at: expires.toISOString() };
}

export async function declineHelp(h: HelpRequest, viewer: Viewer) {
  if (h.status !== 'open') throw new HttpError(400, 'This request is no longer open');
  if (!(await canAnswer(h, viewer.userId))) throw new HttpError(403, 'This request isn’t for you');
  const declined = Array.from(new Set([...h.declined_by, viewer.userId]));
  // Named requests close when everyone asked has said no.
  const allNo = h.target_user_ids.length > 0 && h.target_user_ids.every((id) => declined.includes(id));
  await query(`UPDATE help_requests SET declined_by = $2::bigint[], status = $3, updated_at = NOW() WHERE id = $1`,
    [h.id, declined, allNo ? 'declined' : 'open']);
  await recordHistory(h.ticket_id, viewer.userId, 'help_declined', null, { help_request_id: h.id });
  if (allNo) await notify([h.requested_by], viewer.userId, 'help_declined', `Nobody could take your help request on ticket #${h.ticket_id}`, `/help?request=${h.id}`);
  return { status: allNo ? 'declined' : 'open' };
}

export async function cancelHelp(h: HelpRequest, viewer: Viewer) {
  if (h.requested_by !== viewer.userId && viewer.role !== 'hr') throw new HttpError(403, 'Only the requester or HR can cancel');
  if (h.status === 'cancelled' || h.status === 'expired') return { status: h.status };
  await query(`UPDATE help_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`, [h.id]);
  // Cancelling an accepted request ends the helper's temporary access now.
  if (h.grant_id) await revokeGrant(h.grant_id, viewer.userId);
  await recordHistory(h.ticket_id, viewer.userId, 'help_cancelled', null, { help_request_id: h.id });
  if (h.accepted_by) await notify([h.accepted_by], viewer.userId, 'help_cancelled', `${viewer.name} ended your help access on ticket #${h.ticket_id}`, `/shared`);
  syncRepoAccessSoon(h.project_id);
  return { status: 'cancelled' };
}
