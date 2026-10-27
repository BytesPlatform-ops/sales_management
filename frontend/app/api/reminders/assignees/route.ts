import { NextRequest } from 'next/server';
import { handler, ok, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { assertViewerSees, assignableUsers, resolveItem, roleOf } from '@/lib/reminders/core';
import { canAssignOthers, isReminderEntity } from '@/lib/reminders/rules';

export const dynamic = 'force-dynamic';

/**
 * GET /api/reminders/assignees?entity_type=&entity_id= — who the viewer may remind
 * about this item (always includes themselves first).
 */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const sp = new URL(request.url).searchParams;
  const entity = sp.get('entity_type') || 'none';
  if (!isReminderEntity(entity)) throw new HttpError(400, 'Unknown item type');
  const item = await resolveItem(entity, sp.get('entity_id'), v.userId);
  await assertViewerSees(v, item);
  const me = { id: String(v.userId), name: `${v.name} (me)`, role: v.realRole || v.role };
  if (!canAssignOthers(roleOf(v), entity) || item.projectId === null) return ok({ can_assign_others: false, users: [me] });
  const users = (await assignableUsers(item.projectId)).filter((u) => Number(u.id) !== v.userId);
  return ok({ can_assign_others: true, needs_admin_mode: v.realRole === 'ceo', users: [me, ...users] });
});
