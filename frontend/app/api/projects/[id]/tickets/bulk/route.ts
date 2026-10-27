import { NextRequest } from 'next/server';
import { query } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { capabilities, projectCtx, recordHistory, ticketCtxFor } from '@/lib/tickets/core';
import { applyTicketPatch, HANDOFF_REQUIRED, handoffNeeded, plannedAssignees, setAssignees, TicketPatch } from '@/lib/tickets/update';
import { nextLabels, parseBulk } from '@/lib/tickets/bulk';
import { projectDevIds } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/projects/{id}/tickets/bulk
 * { ids: [..], changes: { status?, priority?, epic_id?, due_date?, label_add?, label_remove?,
 *                         assignees?: { mode: add|replace|remove, user_ids }, delete? } }
 *
 * Each ticket goes through the same rules as a single edit. Nothing is forced:
 * blocked tickets are NOT moved (no confirm in bulk), change requests still need
 * HR approval, and anything the viewer can't do on a ticket is reported, not applied.
 * → { results: [{ id, key, ok, error?, status? }], ok_count, failed_count }
 */
export const PATCH = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { viewer, project } = await projectCtx(request, Number(params.id));
  const { ids, plan } = parseBulk(await readJson(request));
  // Validate the people once so a typo fails the whole request instead of every ticket.
  if (plan.assignees && plan.assignees.mode !== 'remove') await projectDevIds(project.id, plan.assignees.user_ids);

  const found = await query<{ id: number; key: string }>(
    `SELECT id, key FROM tickets WHERE id = ANY($1::int[]) AND project_id = $2 AND deleted_at IS NULL`, [ids, project.id]
  );
  const keyOf = new Map(found.map((t) => [t.id, t.key]));
  const results: { id: number; key?: string; ok: boolean; error?: string; status?: number }[] = [];

  for (const id of ids) {
    if (!keyOf.has(id)) { results.push({ id, ok: false, status: 404, error: 'Not in this project' }); continue; }
    try {
      const ctx = await ticketCtxFor(viewer, id);
      if (plan.delete) {
        if (!capabilities(ctx).delete) throw new HttpError(403, 'Only HR can delete tickets');
        await query(`UPDATE tickets SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
        await recordHistory(id, viewer.userId, 'deleted', null, true);
      } else {
        // Check assignment rights before changing anything, so a ticket isn't half-updated.
        if (plan.assignees && !capabilities(ctx).work) throw new HttpError(403, 'Only the project’s developers or HR can assign');
        // Bulk can't collect a handoff note per ticket: report it instead of skipping silently.
        if (plan.assignees) {
          const { before, want } = await plannedAssignees(ctx, plan.assignees.user_ids, plan.assignees.mode);
          if (handoffNeeded(ctx.ticket.status, before, want)) throw new HttpError(400, `${HANDOFF_REQUIRED} — reassign it from the ticket page`);
        }
        const patch: TicketPatch = { ...plan.patch };
        if (plan.labels) {
          const cur = (await query<{ label_id: number }>(`SELECT label_id FROM ticket_labels WHERE ticket_id = $1`, [id])).map((r) => r.label_id);
          patch.label_ids = nextLabels(cur, plan.labels);
        }
        if (Object.keys(patch).length) await applyTicketPatch(ctx, patch);
        if (plan.assignees) await setAssignees(ctx, plan.assignees.user_ids, plan.assignees.mode);
      }
      results.push({ id, key: keyOf.get(id), ok: true });
    } catch (err) {
      if (!(err instanceof HttpError)) throw err;
      results.push({ id, key: keyOf.get(id), ok: false, status: err.status, error: err.message });
    }
  }
  const okCount = results.filter((r) => r.ok).length;
  return ok({ results, ok_count: okCount, failed_count: results.length - okCount });
});
