/**
 * Agent start dates for salary calculations.
 *
 * Extensions get reused (e.g. ext 18 had another agent's calls for months before
 * Maryam Afzaal joined), and payroll used to count every working day of the
 * month. Days before an agent started must not count as absences, deductions or
 * their calls.
 *
 * Start date = earlier of: the account creation date (PKT calendar date) and the
 * first attendance record (covers agents whose accounts were created after they
 * began). Returns YYYY-MM-DD.
 */
import { query } from './db';

export async function getAgentStartDates(userIds: number[]): Promise<Map<number, string>> {
  const map = new Map<number, string>();
  if (userIds.length === 0) return map;
  const rows = await query<{ id: string; start_date: string | null }>(
    `SELECT u.id,
            LEAST(
              (u.created_at AT TIME ZONE 'Asia/Karachi')::date,
              (SELECT MIN(a.date) FROM attendance a WHERE a.user_id = u.id)
            )::text AS start_date
     FROM users u
     WHERE u.id = ANY($1::bigint[])`,
    [userIds]
  );
  for (const r of rows) if (r.start_date) map.set(Number(r.id), r.start_date);
  return map;
}
