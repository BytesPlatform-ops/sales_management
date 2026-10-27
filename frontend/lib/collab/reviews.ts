/**
 * Review requests inside the app. The reviewer is picked by hand or round-robin
 * among the project's developers (never the requester, anyone out of office, or
 * guests). Requesting a review moves the ticket to In review when the normal
 * status rules allow it.
 *
 * GitHub phase hook: when pr_url is a GitHub PR, mirror its review state here
 * (pull_request_review webhook → approve / request changes).
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { autoPickableSql, nextInRotation } from '@/lib/access/grants';
import { capabilities, notify, recordHistory, ticketLink, watch } from '@/lib/tickets/core';
import type { TicketCtx } from '@/lib/tickets/core';
import { applyTicketPatch } from '@/lib/tickets/update';
import type { Viewer } from '@/lib/projects/core';

export interface ReviewRequest {
  id: number; ticket_id: number; requested_by: number; reviewer_id: number; pr_url: string | null;
  status: 'requested' | 'approved' | 'changes_requested' | 'cancelled'; checklist: { item: string; done: boolean }[];
  comments: string | null; created_at: string; decided_at: string | null;
}
const norm = (r: any): ReviewRequest => ({ ...r, requested_by: Number(r.requested_by), reviewer_id: Number(r.reviewer_id) });

export const DEFAULT_REVIEW_CHECKLIST = ['Works as described in the ticket', 'No console errors', 'Mobile layout checked', 'No secrets or debug code committed'];

/** Developers eligible to review on a project (on it, active, not out of office, not guests), excluding `exclude`. */
export async function eligibleReviewers(projectId: number, exclude: number): Promise<number[]> {
  const rows = await query<{ id: string }>(
    `SELECT u.id FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = $1 AND m.member_role IN ('developer', 'lead_developer') AND u.role = 'developer'
        AND COALESCE(u.is_active, true) AND u.id <> $2 AND ${autoPickableSql('u')}
      ORDER BY u.id`,
    [projectId, exclude]
  );
  return rows.map((r) => Number(r.id));
}

/** Next reviewer in the project's rotation; advances the pointer. */
export async function nextReviewer(projectId: number, requesterId: number): Promise<number> {
  const pool = await eligibleReviewers(projectId, requesterId);
  const ptr = await queryOne<{ last_reviewer_id: string | null }>(`SELECT last_reviewer_id FROM project_review_rotation WHERE project_id = $1`, [projectId]);
  const pick = nextInRotation(pool, ptr?.last_reviewer_id != null ? Number(ptr.last_reviewer_id) : null);
  if (!pick) throw new HttpError(400, 'No other developer on this project is available to review — pick someone');
  await query(
    `INSERT INTO project_review_rotation (project_id, last_reviewer_id) VALUES ($1, $2)
     ON CONFLICT (project_id) DO UPDATE SET last_reviewer_id = EXCLUDED.last_reviewer_id, updated_at = NOW()`,
    [projectId, pick]
  );
  return pick;
}

export async function requestReview(ctx: TicketCtx, b: { reviewer_id?: unknown; pr_url?: unknown; checklist?: unknown }) {
  if (!capabilities(ctx).work) throw new HttpError(403, 'Only the project’s developers or HR can request a review');
  const { ticket: t, viewer, project } = ctx;
  let reviewer: number;
  if (b.reviewer_id !== undefined && b.reviewer_id !== null && b.reviewer_id !== '') {
    reviewer = Number(b.reviewer_id);
    if (reviewer === viewer.userId) throw new HttpError(400, 'Pick someone else to review your work');
    const ok = await queryOne(
      `SELECT 1 FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = $1 AND m.user_id = $2 AND m.member_role IN ('developer', 'lead_developer') AND u.role = 'developer' AND COALESCE(u.is_active, true)`,
      [project.id, reviewer]
    );
    if (!ok) throw new HttpError(400, 'Reviewers must be developers on this project');
  } else {
    reviewer = await nextReviewer(project.id, viewer.userId);
  }
  const pr = b.pr_url ? String(b.pr_url).trim().slice(0, 500) : null;
  if (pr && !/^https?:\/\//i.test(pr)) throw new HttpError(400, 'PR link must start with http(s)://');
  const items = (Array.isArray(b.checklist) && b.checklist.length ? b.checklist : DEFAULT_REVIEW_CHECKLIST)
    .map((x: unknown) => ({ item: String(typeof x === 'object' && x ? (x as any).item : x).slice(0, 300), done: false })).filter((x: any) => x.item).slice(0, 30);
  const row = norm(await queryOne(
    `INSERT INTO review_requests (ticket_id, requested_by, reviewer_id, pr_url, checklist) VALUES ($1, $2, $3, $4, $5::jsonb) RETURNING *`,
    [t.id, viewer.userId, reviewer, pr, JSON.stringify(items)]
  ));
  let moved = false;
  if (t.status === 'open' || t.status === 'in_progress') {
    try { await applyTicketPatch(ctx, { status: 'in_review' }); moved = true; } catch { /* blocked / CR gate: leave the status alone */ }
  }
  await watch(t.id, [reviewer], 'manual');
  await recordHistory(t.id, viewer.userId, 'review_requested', null, { review_id: row.id, reviewer });
  await notify([reviewer], viewer.userId, 'review_request', `${viewer.name} asked you to review ${t.key}: ${t.title}`, ticketLink(project.id, t.key));
  return { ...row, moved_to_review: moved };
}

export async function loadReview(id: number): Promise<ReviewRequest> {
  const r = await queryOne(`SELECT * FROM review_requests WHERE id = $1`, [id]);
  if (!r) throw new HttpError(404, 'Review not found');
  return norm(r);
}

export async function decideReview(ctx: TicketCtx, r: ReviewRequest, viewer: Viewer, b: { action?: unknown; comments?: unknown; checklist?: unknown }) {
  const action = String(b.action);
  if (action === 'cancel') {
    if (r.requested_by !== viewer.userId && viewer.role !== 'hr') throw new HttpError(403, 'Only the requester or HR can cancel');
    if (r.status !== 'requested') throw new HttpError(400, 'Already decided');
    await query(`UPDATE review_requests SET status = 'cancelled', decided_at = NOW() WHERE id = $1`, [r.id]);
    return { status: 'cancelled' };
  }
  if (!['approve', 'request_changes'].includes(action)) throw new HttpError(400, 'action must be approve, request_changes or cancel');
  if (r.reviewer_id !== viewer.userId && viewer.role !== 'hr') throw new HttpError(403, 'Only the reviewer can decide');
  if (r.status !== 'requested') throw new HttpError(400, 'Already decided');
  const comments = b.comments ? String(b.comments).slice(0, 10_000) : null;
  if (action === 'request_changes' && !comments) throw new HttpError(400, 'Say what needs to change');
  const status = action === 'approve' ? 'approved' : 'changes_requested';
  const checklist = Array.isArray(b.checklist) ? JSON.stringify(b.checklist.slice(0, 30)) : null;
  await query(
    `UPDATE review_requests SET status = $2, comments = $3, checklist = COALESCE($4::jsonb, checklist), decided_at = NOW() WHERE id = $1`,
    [r.id, status, comments, checklist]
  );
  const t = ctx.ticket;
  // Changes requested sends the work back to In progress when allowed.
  if (status === 'changes_requested' && (t.status === 'in_review' || t.status === 'in_qa')) {
    try { await applyTicketPatch(ctx, { status: 'in_progress', confirm_blocked: true }); } catch { /* leave it */ }
  }
  await recordHistory(t.id, viewer.userId, 'review_' + status, null, { review_id: r.id });
  await notify([r.requested_by], viewer.userId, `review_${status}`,
    `${viewer.name} ${status === 'approved' ? 'approved' : 'requested changes on'} ${t.key}${comments ? `: ${comments.slice(0, 140)}` : ''}`,
    ticketLink(ctx.project.id, t.key));
  return { status };
}
