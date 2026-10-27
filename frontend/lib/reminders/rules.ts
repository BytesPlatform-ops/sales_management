/**
 * Reminder rules with no database access: repeat dates, snooze/"when" presets in
 * PKT, and who may assign a reminder to whom. Shared by the API and the UI.
 *
 * Firing model (see runner.ts): a reminder is due at COALESCE(snoozed_until, due_at).
 * When it fires, `fired_for` records that moment, so it never fires twice for the
 * same occurrence. Snoozing moves the moment (fires once more, at the new time);
 * a repeating reminder then moves `due_at` to its next occurrence.
 */
export const REPEAT_RULES = ['none', 'daily', 'weekly', 'monthly'] as const;
export type RepeatRule = (typeof REPEAT_RULES)[number];
export const REPEAT_LABELS: Record<RepeatRule, string> = { none: 'Does not repeat', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
export const isRepeatRule = (v: unknown): v is RepeatRule => typeof v === 'string' && (REPEAT_RULES as readonly string[]).includes(v);

export const REMINDER_ENTITIES = ['none', 'project', 'brief_entry', 'ticket', 'meeting', 'message'] as const;
export type ReminderEntity = (typeof REMINDER_ENTITIES)[number];
export const isReminderEntity = (v: unknown): v is ReminderEntity => typeof v === 'string' && (REMINDER_ENTITIES as readonly string[]).includes(v);

export const AUTO_KIND_LABELS: Record<string, string> = {
  client_content_pending: 'Client content pending',
  clarification_unanswered: 'Clarification unanswered',
  meeting_notes_missing: 'Meeting notes missing',
  cycle_renewal: 'Recurring cycle renews soon',
};

/** Pakistan has no daylight saving: PKT is always UTC+5. */
const PKT_OFFSET_MS = 5 * 3600_000;

/** The UTC instant for a PKT wall-clock time on the PKT calendar day `dayOffset` days from `now`. */
export function pktAt(now: Date, dayOffset: number, hour: number, minute = 0): Date {
  const p = new Date(now.getTime() + PKT_OFFSET_MS); // shifted so the UTC fields read as PKT
  const utc = Date.UTC(p.getUTCFullYear(), p.getUTCMonth(), p.getUTCDate() + dayOffset, hour, minute) - PKT_OFFSET_MS;
  return new Date(utc);
}

/** Next Monday 10:00 PKT (a full week ahead if today is Monday). */
export function nextMondayPkt(now: Date, hour = 10): Date {
  const dow = new Date(now.getTime() + PKT_OFFSET_MS).getUTCDay(); // 0 = Sunday
  const days = ((8 - dow) % 7) || 7;
  return pktAt(now, days, hour);
}

export type WhenPreset = '1h' | 'tomorrow' | 'monday' | 'pick';

/** Resolve a "when" choice to a time. 'pick' requires `until`. Throws on bad input. */
export function resolveWhen(preset: unknown, until: unknown, now = new Date()): Date {
  switch (preset) {
    case '1h': return new Date(now.getTime() + 3600_000);
    case 'tomorrow': return pktAt(now, 1, 10);
    case 'monday': return nextMondayPkt(now);
    case 'pick':
    case undefined: {
      const d = new Date(String(until ?? ''));
      if (Number.isNaN(d.getTime())) throw new Error('Pick a date and time');
      return d;
    }
    default: throw new Error('Unknown time choice');
  }
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
}

/**
 * The occurrence after `due`, keeping the PKT time of day. Monthly keeps
 * `repeatDay` (default: due's PKT day), clamped to short months (31 → 30/28/29).
 */
export function nextOccurrence(due: Date, rule: RepeatRule, repeatDay?: number | null): Date | null {
  if (rule === 'none') return null;
  if (rule === 'daily') return new Date(due.getTime() + 86_400_000);
  if (rule === 'weekly') return new Date(due.getTime() + 7 * 86_400_000);
  // monthly, computed on the PKT calendar
  const p = new Date(due.getTime() + PKT_OFFSET_MS);
  const day = repeatDay || p.getUTCDate();
  const y = p.getUTCFullYear();
  const m = p.getUTCMonth() + 1;
  const ny = y + Math.floor(m / 12);
  const nm = m % 12;
  const d = Math.min(day, daysInMonth(ny, nm));
  return new Date(Date.UTC(ny, nm, d, p.getUTCHours(), p.getUTCMinutes(), p.getUTCSeconds()) - PKT_OFFSET_MS);
}

/** First occurrence strictly after `after` (skips occurrences missed while the app was down). */
export function nextOccurrenceAfter(due: Date, rule: RepeatRule, after: Date, repeatDay?: number | null): Date | null {
  let next = nextOccurrence(due, rule, repeatDay);
  for (let i = 0; next && next.getTime() <= after.getTime() && i < 2000; i++) next = nextOccurrence(next, rule, repeatDay);
  return next;
}

/** PKT day of month of a time (for monthly repeats). */
export const pktDayOfMonth = (d: Date) => new Date(d.getTime() + PKT_OFFSET_MS).getUTCDate();

/**
 * Who may set a reminder for someone else:
 *   developers: only themselves
 *   agents, HR (incl. CEO): someone who can see the item (checked separately)
 *   standalone reminders (no item): only yourself, except HR
 */
export function canAssignOthers(role: 'hr' | 'agent' | 'developer', entity: ReminderEntity): boolean {
  if (role === 'developer') return false;
  if (entity === 'none') return role === 'hr';
  return true;
}

export type DueBucket = 'overdue' | 'today' | 'upcoming';

/** "My reminders" grouping: due before now = overdue; later today (PKT) = today; after = upcoming. */
export function dueBucket(effectiveDue: Date, now = new Date()): DueBucket {
  if (effectiveDue.getTime() <= now.getTime()) return 'overdue';
  return effectiveDue.getTime() < pktAt(now, 1, 0).getTime() ? 'today' : 'upcoming';
}
