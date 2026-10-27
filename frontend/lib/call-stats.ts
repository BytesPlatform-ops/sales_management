/**
 * One way to count calls and talk time, shared by the leaderboard, HR Daily
 * Stats, Calls per Hour, HR Payroll, Salary Reports and the agent dashboard.
 *
 *   - Every call counts toward calls_count, however short.
 *   - Talk time counts only calls of 30 seconds or more.
 *   - call_duration may be "SS", "MM:SS" or "HH:MM:SS".
 *   - A call belongs to the agent's own shift date (PKT), worked out from that
 *     agent's shift_start/shift_end, so a 9 PM–5 AM agent and an 8 PM–4 AM
 *     agent both keep a whole night on one date. The day turns over halfway
 *     through the agent's off-hours (13:00 PKT for 9 PM–5 AM, 12:00 for
 *     8 PM–4 AM), so early or late calls stay with the nearest shift.
 *   - HR-added meeting time (daily_stats.meeting_seconds) is added on top by
 *     the caller.
 *
 * call_logs.call_time is `timestamp without time zone` holding UTC.
 */

export const MIN_TALK_SECONDS = 30;

const DEFAULT_SHIFT_START = '21:00';
const DEFAULT_SHIFT_END = '05:00';

/** SQL: seconds in a call_duration column; 0 when it can't be read. */
export function durationSecondsSql(col = 'call_duration'): string {
  return `(CASE
    WHEN ${col} ~ '^[0-9]+:[0-9]+:[0-9]+$' THEN SPLIT_PART(${col}, ':', 1)::int * 3600 + SPLIT_PART(${col}, ':', 2)::int * 60 + SPLIT_PART(${col}, ':', 3)::int
    WHEN ${col} ~ '^[0-9]+:[0-9]+$' THEN SPLIT_PART(${col}, ':', 1)::int * 60 + SPLIT_PART(${col}, ':', 2)::int
    WHEN ${col} ~ '^[0-9]+$' THEN ${col}::int
    ELSE 0 END)`;
}

/** SQL: talk seconds a call contributes (0 for calls under 30 s). */
export function talkSecondsSql(col = 'call_duration'): string {
  const secs = durationSecondsSql(col);
  return `(CASE WHEN ${secs} >= ${MIN_TALK_SECONDS} THEN ${secs} ELSE 0 END)`;
}

/**
 * SQL: seconds after PKT midnight where the agent's shift date turns over —
 * the middle of their off-hours.
 */
function pivotSecondsSql(startCol: string, endCol: string): string {
  const s = `EXTRACT(EPOCH FROM COALESCE(${startCol}, '${DEFAULT_SHIFT_START}'::time))::int`;
  const e = `EXTRACT(EPOCH FROM COALESCE(${endCol}, '${DEFAULT_SHIFT_END}'::time))::int`;
  const length = `MOD(${e} - ${s} + 86400, 86400)`;
  return `MOD(${e} + (86400 - ${length}) / 2, 86400)`;
}

/** SQL: the PKT shift date of a UTC timestamp, for an agent's shift columns. */
export function shiftDateSql(utcTimestamp: string, startCol = 'u.shift_start', endCol = 'u.shift_end'): string {
  return `((((${utcTimestamp}) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi') - make_interval(secs => ${pivotSecondsSql(startCol, endCol)}))::date`;
}

/**
 * SQL: the agent's current shift date — the date of the most recent shift
 * start (before 9 PM that is still last night's shift, like the agent
 * dashboard and the HR "working date").
 */
export function currentShiftDateSql(startCol = 'u.shift_start'): string {
  return `((NOW() AT TIME ZONE 'Asia/Karachi') - COALESCE(${startCol}, '${DEFAULT_SHIFT_START}'::time))::date`;
}

/** SQL: a call's PKT clock hour (0–23). */
export function pktHourSql(utcTimestamp = 'cl.call_time'): string {
  return `EXTRACT(HOUR FROM ((${utcTimestamp}) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Karachi')::int`;
}

/**
 * SQL subquery: calls and talk time per agent per shift date, for shift dates
 * from `fromDate` to `toDate` (SQL date expressions, e.g. '$1::date').
 * Columns: user_id, date (YYYY-MM-DD text), calls_count, talk_time_seconds.
 * `extraWhere` filters users, e.g. `AND u.id = $3`.
 */
export function shiftCallTotalsSql(fromDate: string, toDate: string, extraWhere = ''): string {
  return `(
    SELECT user_id, shift_date::text AS date,
           COUNT(*)::int AS calls_count,
           COALESCE(SUM(talk), 0)::int AS talk_time_seconds
      FROM (
        SELECT u.id AS user_id,
               ${shiftDateSql('cl.call_time')} AS shift_date,
               ${talkSecondsSql('cl.call_duration')} AS talk
          FROM call_logs cl
          JOIN users u ON u.extension_number = cl.agent_extension
         WHERE cl.call_time >= ((${fromDate}) - 1)::timestamp
           AND cl.call_time < ((${toDate}) + 2)::timestamp
           ${extraWhere}
      ) per_call
     WHERE shift_date BETWEEN (${fromDate}) AND (${toDate})
     GROUP BY user_id, shift_date
  )`;
}

/** Talk time for a day: call talk time plus HR-added meeting time. */
export function dayTalkSeconds(callTalkSeconds: number, meetingSeconds: number): number {
  return (Number(callTalkSeconds) || 0) + (Number(meetingSeconds) || 0);
}

/**
 * Merge one day's call_logs totals with its daily_stats row.
 * With call_logs: calls from call_logs, talk = call talk + meeting time.
 * Without: fall back to daily_stats (its talk_time_seconds already includes
 * meeting time).
 */
export function mergeDay(
  c: { calls: number; talk: number } | undefined,
  s: { calls: number; talk: number; meeting: number } | undefined
): { calls: number; talk: number } {
  if (c) return { calls: c.calls, talk: dayTalkSeconds(c.talk, s?.meeting || 0) };
  if (s) return { calls: s.calls, talk: s.talk };
  return { calls: 0, talk: 0 };
}

/** The PKT shift date (YYYY-MM-DD) an instant falls in, for an agent's shift. */
export function shiftDateFor(
  instant: Date,
  shiftStart: string | null = DEFAULT_SHIFT_START,
  shiftEnd: string | null = DEFAULT_SHIFT_END
): string {
  const toSecs = (t: string) => {
    const [h, m, s] = t.split(':').map(Number);
    return (h || 0) * 3600 + (m || 0) * 60 + (s || 0);
  };
  const s = toSecs(shiftStart || DEFAULT_SHIFT_START);
  const e = toSecs(shiftEnd || DEFAULT_SHIFT_END);
  const length = (e - s + 86400) % 86400;
  const pivot = (e + (86400 - length) / 2) % 86400;
  const pkt = new Date(instant.getTime() + 5 * 3600 * 1000 - pivot * 1000); // PKT is fixed UTC+5
  return pkt.toISOString().slice(0, 10);
}
