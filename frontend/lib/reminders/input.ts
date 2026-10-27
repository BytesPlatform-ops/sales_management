/** Validating reminder requests, shared by create and edit. */
import { NextRequest } from 'next/server';
import { HttpError } from '@/lib/training/http';
import { Viewer } from '@/lib/projects/core';
import { verifyRequest } from '@/lib/auth/session';
import { str } from '@/lib/tickets/input';
import { canAssignOthers, isRepeatRule, RepeatRule, ReminderEntity, resolveWhen } from './rules';
import { isSelf, ResolvedItem, roleOf, userCanSeeProject } from './core';

/** due: { preset: '1h'|'tomorrow'|'monday'|'pick', until? } or an ISO string in `due_at`. */
export function parseDue(b: any, now = new Date()): Date {
  try {
    return b.due_at !== undefined && b.preset === undefined ? resolveWhen('pick', b.due_at, now) : resolveWhen(b.preset ?? 'pick', b.until ?? b.due_at, now);
  } catch (e) {
    throw new HttpError(400, (e as Error).message);
  }
}

export function parseRepeat(v: unknown): RepeatRule {
  if (v === undefined || v === null || v === '') return 'none';
  if (!isRepeatRule(v)) throw new HttpError(400, 'Repeat must be none, daily, weekly or monthly');
  return v;
}

export const parseTitle = (v: unknown) => str(v, 'Title', 200, true)!;
export const parseNote = (v: unknown) => str(v, 'Note', 2000) || null;

/**
 * Who the reminder is for. Yourself always; someone else only if your role allows
 * it for this kind of item AND they can see the item. A CEO reminding someone else
 * needs Admin mode (their own reminders don't).
 */
export async function resolveAssignee(request: NextRequest, viewer: Viewer, entity: ReminderEntity, item: ResolvedItem, raw: unknown): Promise<number> {
  if (raw === undefined || raw === null || raw === '' || isSelf(viewer, Number(raw))) return viewer.userId;
  const target = Number(raw);
  if (!Number.isInteger(target) || target <= 0) throw new HttpError(400, 'Invalid assignee');
  if (!canAssignOthers(roleOf(viewer), entity)) {
    throw new HttpError(403, entity === 'none' ? 'Standalone reminders are for yourself' : 'You can only set reminders for yourself');
  }
  if (viewer.realRole === 'ceo' && !(await verifyRequest(request)).adminActive) {
    throw new HttpError(403, 'Turn on Admin mode to set reminders for other people');
  }
  if (item.projectId !== null && !(await userCanSeeProject(target, item.projectId))) {
    throw new HttpError(400, 'That person can’t see this item');
  }
  return target;
}
