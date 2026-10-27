/**
 * Manual tracking for projects that don't use GitHub (WordPress, Shopify, design…):
 * developers post a short "work update" (text, files, linked tickets, optional
 * status moves). It counts as project activity, so health stays honest.
 * At 18:00 PKT developers on manual projects who posted nothing that day get one reminder.
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { notify, once } from '@/lib/notifications';
import { Viewer } from '@/lib/projects/core';
import { ticketCtxFor } from '@/lib/tickets/core';
import { applyTicketPatch } from '@/lib/tickets/update';
import { isStatus } from '@/lib/tickets/rules';
import { recordActivity } from '@/lib/activity';
import { pktDate } from '@/lib/github/rules';

export async function canPostWorkUpdate(viewer: Viewer, projectId: number): Promise<boolean> {
  if (viewer.role === 'hr') return true;
  if (viewer.role !== 'developer') return false;
  const m = await queryOne(`SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 AND member_role IN ('developer', 'lead_developer')`, [projectId, viewer.userId]);
  return !!m;
}

export interface WorkUpdateInput { body?: unknown; ticket_ids?: unknown; status_moves?: unknown }

export async function createWorkUpdate(viewer: Viewer, project: { id: number; ticket_no: string }, b: WorkUpdateInput) {
  if (viewer.readonly) throw new HttpError(403, 'Read-only');
  if (!(await canPostWorkUpdate(viewer, project.id))) throw new HttpError(403, 'Only the project’s developers or HR can post work updates');
  const body = String(b.body ?? '').trim();
  if (!body) throw new HttpError(400, 'Write what you did');
  if (body.length > 10_000) throw new HttpError(400, 'Keep the update under 10,000 characters');
  const wanted = Array.isArray(b.ticket_ids) ? Array.from(new Set(b.ticket_ids.map(Number).filter(Number.isFinite))).slice(0, 50) : [];
  const valid = wanted.length
    ? (await query<{ id: number }>(`SELECT id FROM tickets WHERE id = ANY($1::int[]) AND project_id = $2 AND deleted_at IS NULL`, [wanted, project.id])).map((r) => r.id)
    : [];
  if (valid.length !== wanted.length) throw new HttpError(400, 'Linked tickets must be in this project');

  // Status moves go through the normal ticket rules (CR gate, blocked confirm, permissions).
  const moves = Array.isArray(b.status_moves) ? b.status_moves : [];
  const moveResults: { ticket_id: number; ok: boolean; error?: string }[] = [];
  for (const m of moves.slice(0, 50)) {
    const tid = Number(m?.ticket_id);
    if (!valid.includes(tid) || !isStatus(m?.status)) { moveResults.push({ ticket_id: tid, ok: false, error: 'Link the ticket and pick a valid status' }); continue; }
    try {
      await applyTicketPatch(await ticketCtxFor(viewer, tid), { status: m.status, confirm_blocked: !!m.confirm_blocked });
      moveResults.push({ ticket_id: tid, ok: true });
    } catch (e) {
      moveResults.push({ ticket_id: tid, ok: false, error: (e as Error).message });
    }
  }

  const row = await queryOne<{ id: number; created_at: string }>(
    `INSERT INTO work_updates (project_id, user_id, body, ticket_ids) VALUES ($1, $2, $3, $4::int[]) RETURNING id, created_at`,
    [project.id, viewer.userId, body, valid]
  );
  const firstLine = body.split('\n')[0].slice(0, 140);
  await recordActivity({
    projectId: project.id, ticketId: valid.length === 1 ? valid[0] : null, actorUserId: viewer.userId, kind: 'work_update',
    summary: `${viewer.name} posted an update: ${firstLine}`, url: `/projects/${project.id}?tab=activity`, source: 'manual', sourceId: `work-update:${row!.id}`,
  });
  return { id: row!.id, created_at: row!.created_at, moves: moveResults };
}

/**
 * Daily (from 18:00 PKT): one in-app reminder to each developer on an open
 * manual-tracking project who hasn't posted a work update today (PKT).
 */
export async function runWorkUpdateReminders(now = new Date()): Promise<number> {
  const today = pktDate(now);
  const rows = await query<{ user_id: string; projects: { id: number; ticket_no: string; title: string }[] }>(
    `SELECT m.user_id, json_agg(json_build_object('id', p.id, 'ticket_no', p.ticket_no, 'title', p.title) ORDER BY p.ticket_no) AS projects
       FROM project_members m
       JOIN projects p ON p.id = m.project_id
       JOIN users u ON u.id = m.user_id AND u.role = 'developer' AND COALESCE(u.is_active, true)
      WHERE m.member_role IN ('developer', 'lead_developer')
        AND p.tracking_source = 'manual' AND p.status IN ('new', 'in_progress', 'review')
        AND NOT EXISTS (
          SELECT 1 FROM work_updates w
           WHERE w.project_id = p.id AND w.user_id = m.user_id AND w.deleted_at IS NULL
             AND (w.created_at AT TIME ZONE 'Asia/Karachi')::date = $1::date)
      GROUP BY m.user_id`,
    [today]
  );
  let sent = 0;
  for (const r of rows) {
    if (!(await once(`work-update-reminder:${r.user_id}:${today}`))) continue;
    const list = r.projects.map((p) => p.ticket_no).join(', ');
    await notify({
      users: [Number(r.user_id)], actorId: null, type: 'work_update_reminder',
      body: `Post today's work update for ${list}`,
      link: r.projects.length === 1 ? `/projects/${r.projects[0].id}?tab=activity` : '/overview',
      projectId: r.projects.length === 1 ? r.projects[0].id : null,
    });
    sent++;
  }
  return sent;
}
