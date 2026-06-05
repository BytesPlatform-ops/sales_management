/**
 * Shift-date helpers for overnight shifts (9 PM PKT pivot).
 *
 * Matches the existing dashboard logic in attendance-utils.ts: any Karachi
 * wall-clock hour BEFORE the shift start belongs to the previous day's shift;
 * the shift start hour onward belongs to that calendar day.
 *
 * Pakistan has no DST (fixed UTC+5), so Intl extraction here yields the same
 * shift_date the dashboards use.
 */

const KARACHI_TZ = 'Asia/Karachi';
const SHIFT_START_HOUR = 21; // 9 PM PKT — the pivot

/**
 * Compute the shift_date (YYYY-MM-DD) an instant belongs to.
 *
 * Examples (9PM–5AM shift):
 *   2026-06-05T23:00 PKT -> "2026-06-05"
 *   2026-06-06T04:00 PKT -> "2026-06-05"
 *   2026-06-05T18:00 UTC (= 23:00 PKT Jun 5) -> "2026-06-05"
 */
export function getShiftDate(
  timestamp: string | Date,
  shiftStartHour: number = SHIFT_START_HOUR
): string {
  const d = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(d.getTime())) throw new Error(`Invalid timestamp: ${timestamp}`);

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: KARACHI_TZ,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  }).formatToParts(d);

  const get = (t: string) => parts.find((p) => p.type === t)!.value;
  let year = Number(get('year'));
  let month = Number(get('month'));
  let day = Number(get('day'));
  let hour = Number(get('hour'));
  if (hour === 24) hour = 0; // some runtimes emit "24" for midnight

  if (hour < shiftStartHour) {
    const back = new Date(Date.UTC(year, month - 1, day));
    back.setUTCDate(back.getUTCDate() - 1);
    year = back.getUTCFullYear();
    month = back.getUTCMonth() + 1;
    day = back.getUTCDate();
  }

  const mm = String(month).padStart(2, '0');
  const dd = String(day).padStart(2, '0');
  return `${year}-${mm}-${dd}`;
}
