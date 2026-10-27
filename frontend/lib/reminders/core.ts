/**
 * Reminders: what a reminder points at, who may see/assign it, and creating one.
 * Delivery lives in ./runner, automatic reminders in ./auto, pure rules in ./rules.
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { loadProject, Viewer } from '@/lib/projects/core';
import { projectGrantSql } from '@/lib/access/grants';
import { effectiveRole } from '@/lib/auth/session';
import { ticketLink } from '@/lib/tickets/core';
import { pktDayOfMonth, RepeatRule, ReminderEntity } from './rules';

export interface ReminderRow {
  id: number; entity_type: ReminderEntity; entity_id: string | null; project_id: number | null; title: string; note: string | null;
  due_at: string; repeat_rule: RepeatRule; repeat_day: number | null; assigned_to: string; created_by: string | null;
  status: 'open' | 'done' | 'cancelled'; snoozed_until: string | null; fired_for: string | null; sent_at: string | null;
  last_fired_at: string | null; fire_count: number; auto_kind: string | null; auto_key: string | null; email: boolean;
  done_at: string | null; created_at: string; updated_at: string;
}

export const REMINDER_COLS = `r.id, r.entity_type, r.entity_id, r.project_id, r.title, r.note, r.due_at, r.repeat_rule, r.repeat_day,
  r.assigned_to, r.created_by, r.status, r.snoozed_until, r.fired_for, r.sent_at, r.last_fired_at, r.fire_count, r.auto_kind,
  r.auto_key, r.email, r.done_at, r.created_at, r.updated_at`;

export interface ResolvedItem { projectId: number | null; link: string; label: string }

/**
 * The thing a reminder is about: its project, a link and a short label.
 * 404 if it doesn't exist (or is a message draft that isn't `viewerId`'s).
 */
export async function resolveItem(entity: ReminderEntity, entityId: unknown, viewerId?: number): Promise<ResolvedItem> {
  if (entity === 'none') return { projectId: null, link: '/my-tasks#reminders', label: 'Reminder' };
  const id = Number(entityId);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid item id');
  switch (entity) {
    case 'project': {
      const p = await queryOne<{ id: number; ticket_no: string; title: string }>(`SELECT id, ticket_no, title FROM projects WHERE id = $1`, [id]);
      if (!p) throw new HttpError(404, 'Project not found');
      return { projectId: p.id, link: `/projects/${p.id}`, label: `${p.ticket_no} ${p.title}` };
    }
    case 'ticket': {
      const t = await queryOne<{ project_id: number; key: string; title: string }>(
        `SELECT project_id, key, title FROM tickets WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!t) throw new HttpError(404, 'Ticket not found');
      return { projectId: t.project_id, link: ticketLink(t.project_id, t.key), label: `${t.key} ${t.title}` };
    }
    case 'brief_entry': {
      const e = await queryOne<{ project_id: number; ticket_no: string }>(
        `SELECT e.project_id, p.ticket_no FROM brief_entries e JOIN projects p ON p.id = e.project_id WHERE e.id = $1 AND e.deleted_at IS NULL`, [id]);
      if (!e) throw new HttpError(404, 'Brief update not found');
      return { projectId: e.project_id, link: `/projects/${e.project_id}?tab=brief#brief-${id}`, label: `Brief update · ${e.ticket_no}` };
    }
    case 'meeting': {
      const m = await queryOne<{ project_id: number; title: string }>(`SELECT project_id, title FROM project_meetings WHERE id = $1`, [id]);
      if (!m) throw new HttpError(404, 'Meeting not found');
      return { projectId: m.project_id, link: `/projects/${m.project_id}?tab=meetings`, label: m.title };
    }
    case 'message': {
      const m = await queryOne<{ project_id: number; user_id: string | null; is_draft: boolean; ticket_no: string }>(
        `SELECT pm.project_id, pm.user_id, pm.is_draft, p.ticket_no FROM project_messages pm JOIN projects p ON p.id = pm.project_id
          WHERE pm.id = $1 AND pm.deleted_at IS NULL`, [id]);
      if (!m || (m.is_draft && Number(m.user_id) !== viewerId)) throw new HttpError(404, 'Message not found');
      return { projectId: m.project_id, link: `/projects/${m.project_id}?tab=thread#msg-${id}`, label: `Message in ${m.ticket_no}` };
    }
  }
  throw new HttpError(400, 'Unknown item type');
}

/** Can this user see the project? Same rules as visibilityClause (HR/CEO all, developer member, agent owner). */
export async function userCanSeeProject(userId: number, projectId: number): Promise<boolean> {
  const r = await queryOne(
    `SELECT 1 FROM users u JOIN projects p ON p.id = $2
      WHERE u.id = $1 AND COALESCE(u.is_active, true)
        AND (u.role IN ('hr', 'ceo')
             OR (u.role = 'developer' AND EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = p.id AND m.user_id = u.id))
             OR ${projectGrantSql('p', 'u.id')}
             OR (u.role = 'agent' AND p.created_by = u.id))`,
    [userId, projectId]
  );
  return !!r;
}

/** The viewer must be able to see the item; 404 otherwise (never reveal that it exists). */
export async function assertViewerSees(viewer: Viewer, item: ResolvedItem) {
  if (item.projectId === null) return;
  try {
    // A reminder only notifies; grant-only readers may set one for themselves.
    await loadProject(item.projectId, viewer, { grantWrite: 'view' });
  } catch {
    throw new HttpError(404, 'Not found');
  }
}

/** People a reminder on this item could be assigned to (for the picker). */
export async function assignableUsers(projectId: number) {
  return query<{ id: string; name: string; role: string }>(
    `SELECT u.id, u.full_name AS name, u.role FROM users u
      WHERE COALESCE(u.is_active, true) AND u.role IN ('agent', 'developer', 'hr')
        AND (EXISTS (SELECT 1 FROM project_members m WHERE m.project_id = $1 AND m.user_id = u.id AND m.member_role IN ('developer', 'lead_developer'))
             OR u.id = (SELECT created_by FROM projects WHERE id = $1)
             OR u.id = (SELECT supervisor_id FROM projects WHERE id = $1))
      ORDER BY u.full_name`,
    [projectId]
  );
}

export interface NewReminder {
  entity_type: ReminderEntity; entity_id: string | null; project_id: number | null; title: string; note?: string | null;
  due_at: Date; repeat_rule: RepeatRule; assigned_to: number; created_by: number | null; email?: boolean;
  auto_kind?: string | null; auto_key?: string | null;
}

/** Insert a reminder. With an auto_key, an existing reminder for the same key wins (returns null). */
export async function insertReminder(r: NewReminder): Promise<ReminderRow | null> {
  return queryOne<ReminderRow>(
    `INSERT INTO reminders (entity_type, entity_id, project_id, title, note, due_at, repeat_rule, repeat_day, assigned_to, created_by,
                            email, auto_kind, auto_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT (auto_key) DO NOTHING
     RETURNING ${REMINDER_COLS.replace(/r\./g, '')}`,
    [r.entity_type, r.entity_id, r.project_id, r.title.slice(0, 200), r.note ?? null, r.due_at, r.repeat_rule,
      r.repeat_rule === 'monthly' ? pktDayOfMonth(r.due_at) : null, r.assigned_to, r.created_by, !!r.email,
      r.auto_kind ?? null, r.auto_key ?? null]
  );
}

/** Stop an automatic reminder that's no longer needed (question answered, notes written…). */
export async function cancelAuto(autoKey: string) {
  await query(`UPDATE reminders SET status = 'cancelled', updated_at = NOW() WHERE auto_key = $1 AND status = 'open'`, [autoKey]);
}

/** Load a reminder the viewer is involved in (assignee or creator). */
export async function loadReminder(viewer: Viewer, id: number): Promise<ReminderRow> {
  const r = await queryOne<ReminderRow>(`SELECT ${REMINDER_COLS} FROM reminders r WHERE r.id = $1`, [id]);
  if (!r || (Number(r.assigned_to) !== viewer.userId && Number(r.created_by) !== viewer.userId)) throw new HttpError(404, 'Reminder not found');
  return r;
}

export const isSelf = (viewer: Viewer, userId: number | string) => Number(userId) === viewer.userId;
export const roleOf = (viewer: Viewer) => effectiveRole(viewer.realRole || viewer.role);
