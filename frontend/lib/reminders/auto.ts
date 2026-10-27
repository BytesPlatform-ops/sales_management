/**
 * Automatic reminders, generated hourly (and idempotent: one reminder per auto_key).
 *
 *   client_content_pending    Requirement tagged waiting_on_client, no follow-up from the
 *                             agent (newer brief update or thread message) for N days → agent
 *   clarification_unanswered  a developer's "Need clarification" unanswered for N hours → agent
 *                             (also scheduled the moment it's asked; cancelled when answered)
 *   meeting_notes_missing     meeting ended N hours ago with no notes → its organiser
 *   cycle_renewal             recurring cycle ends in N days → agent
 *
 * Per-project thresholds/toggles live in project_reminder_settings (defaults below).
 * Reminders whose reason went away (follow-up sent, notes written…) are cancelled
 * if they haven't fired yet.
 */
import { query } from '@/lib/db';
import { insertReminder } from './core';

export const REMINDER_DEFAULTS = {
  client_content_enabled: true, client_content_days: 3,
  clarification_enabled: true, clarification_hours: 24,
  meeting_notes_enabled: true, meeting_notes_hours: 2,
  cycle_renewal_enabled: true, cycle_renewal_days: 7,
};
export type ReminderSettings = typeof REMINDER_DEFAULTS;

/** SQL: settings for project alias `p` with defaults (use inside a FROM … LEFT JOIN). */
const S = `LEFT JOIN project_reminder_settings s ON s.project_id = p.id`;
const opt = (col: keyof ReminderSettings) => `COALESCE(s.${col}, ${typeof REMINDER_DEFAULTS[col] === 'boolean' ? REMINDER_DEFAULTS[col] : Number(REMINDER_DEFAULTS[col])})`;

export async function projectSettings(projectId: number): Promise<ReminderSettings> {
  const rows = await query<ReminderSettings>(`SELECT * FROM project_reminder_settings WHERE project_id = $1`, [projectId]);
  return { ...REMINDER_DEFAULTS, ...(rows[0] ? pick(rows[0]) : {}) };
}
function pick(r: any): Partial<ReminderSettings> {
  const out: any = {};
  for (const k of Object.keys(REMINDER_DEFAULTS)) if (r[k] !== undefined && r[k] !== null) out[k] = r[k];
  return out;
}

const ACTIVE_PROJECT = `p.status NOT IN ('closed', 'cancelled')`;

async function clientContentPending(): Promise<number> {
  // Follow-up = a newer brief update or a non-system thread message from the project's agent.
  const followUp = `(EXISTS (SELECT 1 FROM brief_entries f WHERE f.project_id = e.project_id AND f.created_by = p.created_by
                              AND f.created_at > e.created_at AND f.deleted_at IS NULL)
                     OR EXISTS (SELECT 1 FROM project_messages m WHERE m.project_id = e.project_id AND m.user_id = p.created_by
                              AND m.created_at > e.created_at AND m.kind <> 'system' AND m.deleted_at IS NULL AND NOT m.is_draft))`;
  const due = await query<{ id: number; project_id: number; created_by: string; ticket_no: string }>(
    `SELECT e.id, e.project_id, p.created_by, p.ticket_no FROM brief_entries e JOIN projects p ON p.id = e.project_id ${S}
      WHERE e.type = 'requirement' AND 'waiting_on_client' = ANY(e.tags) AND e.deleted_at IS NULL AND ${ACTIVE_PROJECT}
        AND ${opt('client_content_enabled')}
        AND e.created_at <= NOW() - make_interval(days => ${opt('client_content_days')})
        AND NOT ${followUp}`
  );
  let n = 0;
  for (const e of due) {
    const r = await insertReminder({
      entity_type: 'brief_entry', entity_id: String(e.id), project_id: e.project_id, assigned_to: Number(e.created_by), created_by: null,
      title: `Follow up with the client: content still pending (${e.ticket_no})`, due_at: new Date(), repeat_rule: 'none',
      auto_kind: 'client_content_pending', auto_key: `client_content:${e.id}`,
    });
    if (r) n++;
  }
  // The agent followed up, or the tag was removed: drop reminders that haven't fired.
  await query(
    `UPDATE reminders r SET status = 'cancelled', updated_at = NOW()
       FROM brief_entries e JOIN projects p ON p.id = e.project_id
      WHERE r.auto_kind = 'client_content_pending' AND r.status = 'open' AND r.fired_for IS NULL AND r.entity_id = e.id::text
        AND (e.deleted_at IS NOT NULL OR NOT ('waiting_on_client' = ANY(e.tags)) OR ${followUp})`
  );
  return n;
}

/** Schedule (or backfill) "clarification unanswered" for an open question. */
export async function scheduleClarification(markId: number, entryId: number, projectId: number, agentId: number, ticketNo: string, askedAt: Date, hours?: number) {
  const h = hours ?? (await projectSettings(projectId)).clarification_hours;
  return insertReminder({
    entity_type: 'brief_entry', entity_id: String(entryId), project_id: projectId, assigned_to: agentId, created_by: null,
    title: `A developer is still waiting for your answer (${ticketNo})`, due_at: new Date(askedAt.getTime() + h * 3600_000),
    repeat_rule: 'none', auto_kind: 'clarification_unanswered', auto_key: `clarification:${markId}`,
  });
}

async function clarificationUnanswered(): Promise<number> {
  const open = await query<{ id: number; entry_id: number; project_id: number; created_by: string; ticket_no: string; created_at: string; hours: number }>(
    `SELECT mk.id, mk.entry_id, e.project_id, p.created_by, p.ticket_no, mk.created_at, ${opt('clarification_hours')} AS hours
       FROM brief_entry_marks mk JOIN brief_entries e ON e.id = mk.entry_id JOIN projects p ON p.id = e.project_id ${S}
      WHERE mk.kind = 'need_clarification' AND mk.resolved_at IS NULL AND e.deleted_at IS NULL AND ${ACTIVE_PROJECT}
        AND ${opt('clarification_enabled')}
        AND NOT EXISTS (SELECT 1 FROM reminders r WHERE r.auto_key = 'clarification:' || mk.id)`
  );
  let n = 0;
  for (const m of open) {
    if (await scheduleClarification(m.id, m.entry_id, m.project_id, Number(m.created_by), m.ticket_no, new Date(m.created_at), Number(m.hours))) n++;
  }
  await query(
    `UPDATE reminders r SET status = 'cancelled', updated_at = NOW() FROM brief_entry_marks mk
      WHERE r.auto_kind = 'clarification_unanswered' AND r.status = 'open' AND r.auto_key = 'clarification:' || mk.id
        AND mk.resolved_at IS NOT NULL`
  );
  return n;
}

async function meetingNotesMissing(): Promise<number> {
  const ended = await query<{ id: number; project_id: number; created_by: string; title: string }>(
    `SELECT mt.id, mt.project_id, mt.created_by, mt.title FROM project_meetings mt JOIN projects p ON p.id = mt.project_id ${S}
      WHERE mt.status <> 'cancelled' AND COALESCE(TRIM(mt.outcome), '') = '' AND ${opt('meeting_notes_enabled')}
        AND mt.starts_at + make_interval(mins => mt.duration_min) + make_interval(hours => ${opt('meeting_notes_hours')}) <= NOW()
        AND mt.starts_at > NOW() - INTERVAL '14 days'`
  );
  let n = 0;
  for (const m of ended) {
    const r = await insertReminder({
      entity_type: 'meeting', entity_id: String(m.id), project_id: m.project_id, assigned_to: Number(m.created_by), created_by: null,
      title: `Add notes for "${m.title}"`, due_at: new Date(), repeat_rule: 'none',
      auto_kind: 'meeting_notes_missing', auto_key: `meeting_notes:${m.id}`,
    });
    if (r) n++;
  }
  await query(
    `UPDATE reminders r SET status = 'cancelled', updated_at = NOW() FROM project_meetings mt
      WHERE r.auto_kind = 'meeting_notes_missing' AND r.status = 'open' AND r.entity_id = mt.id::text
        AND (mt.status = 'cancelled' OR COALESCE(TRIM(mt.outcome), '') <> '')`
  );
  return n;
}

async function cycleRenewal(): Promise<number> {
  const soon = await query<{ id: number; project_id: number; created_by: string; ticket_no: string; period_end: string; cycle_no: number }>(
    `SELECT c.id, c.project_id, p.created_by, p.ticket_no, c.period_end::text AS period_end, c.cycle_no
       FROM project_cycles c JOIN projects p ON p.id = c.project_id ${S}
      WHERE c.status = 'open' AND p.project_type = 'recurring' AND ${ACTIVE_PROJECT} AND ${opt('cycle_renewal_enabled')}
        AND c.period_end >= CURRENT_DATE AND c.period_end - ${opt('cycle_renewal_days')} <= CURRENT_DATE`
  );
  let n = 0;
  for (const c of soon) {
    const r = await insertReminder({
      entity_type: 'project', entity_id: String(c.project_id), project_id: c.project_id, assigned_to: Number(c.created_by), created_by: null,
      title: `${c.ticket_no}: cycle ${c.cycle_no} renews on ${c.period_end} — check in with the client`, due_at: new Date(), repeat_rule: 'none',
      auto_kind: 'cycle_renewal', auto_key: `cycle_renewal:${c.id}`,
    });
    if (r) n++;
  }
  return n;
}

/** Generate every kind. Each kind is independent: one failing doesn't stop the others. */
export async function runAutoReminders(): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [name, fn] of [
    ['client_content_pending', clientContentPending], ['clarification_unanswered', clarificationUnanswered],
    ['meeting_notes_missing', meetingNotesMissing], ['cycle_renewal', cycleRenewal],
  ] as const) {
    try {
      out[name] = await fn();
    } catch (err) {
      if (!/does not exist/.test(String((err as Error)?.message))) console.error(`[reminders] auto ${name}`, (err as Error)?.message);
      out[name] = 0;
    }
  }
  return out;
}
