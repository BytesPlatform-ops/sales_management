import { query, queryOne } from '../config/database';

export interface DailyStats {
  id: number;
  user_id: number;
  date: string;
  calls_count: number;
  talk_time_seconds: number;
  leads_count: number;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface DailyStatsWithUser extends DailyStats {
  full_name: string;
  extension_number: string;
}

export async function getStatsByUserAndDate(
  userId: number,
  date: string
): Promise<DailyStats | null> {
  return queryOne<DailyStats>(
    'SELECT * FROM daily_stats WHERE user_id = $1 AND date = $2',
    [userId, date]
  );
}

export async function getStatsByDate(date: string): Promise<DailyStatsWithUser[]> {
  return query<DailyStatsWithUser>(
    `SELECT d.*, u.full_name, u.extension_number 
     FROM daily_stats d
     JOIN users u ON d.user_id = u.id
     WHERE d.date = $1
     ORDER BY d.calls_count DESC`,
    [date]
  );
}

export async function getMonthlyStats(
  userId: number,
  year: number,
  month: number
): Promise<DailyStats[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).toISOString().split('T')[0];

  return query<DailyStats>(
    'SELECT * FROM daily_stats WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date',
    [userId, startDate, endDate]
  );
}

export async function getMonthlyStatsSummary(
  userId: number,
  year: number,
  month: number
): Promise<{ total_calls: number; total_talk_time: number; total_leads: number }> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).toISOString().split('T')[0];

  const result = await queryOne<{
    total_calls: string;
    total_talk_time: string;
    total_leads: string;
  }>(
    `SELECT 
       COALESCE(SUM(calls_count), 0) as total_calls,
       COALESCE(SUM(talk_time_seconds), 0) as total_talk_time,
       COALESCE(SUM(leads_count), 0) as total_leads
     FROM daily_stats 
     WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
    [userId, startDate, endDate]
  );

  return {
    total_calls: parseInt(result?.total_calls || '0', 10),
    total_talk_time: parseInt(result?.total_talk_time || '0', 10),
    total_leads: parseInt(result?.total_leads || '0', 10),
  };
}

export async function upsertStats(
  userId: number,
  date: string,
  data: Partial<{
    calls_count: number;
    talk_time_seconds: number;
    leads_count: number;
    notes: string;
  }>
): Promise<DailyStats> {
  const result = await queryOne<DailyStats>(
    `INSERT INTO daily_stats (user_id, date, calls_count, talk_time_seconds, leads_count, notes)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, date) 
     DO UPDATE SET 
       calls_count = COALESCE($3, daily_stats.calls_count),
       talk_time_seconds = COALESCE($4, daily_stats.talk_time_seconds),
       leads_count = COALESCE($5, daily_stats.leads_count),
       notes = COALESCE($6, daily_stats.notes),
       updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [
      userId,
      date,
      data.calls_count ?? 0,
      data.talk_time_seconds ?? 0,
      data.leads_count ?? 0,
      data.notes ?? null,
    ]
  );

  if (!result) {
    throw new Error('Failed to upsert stats');
  }

  return result;
}

export async function syncFromCallLogs(userId: number, extensionNumber: string, date: string): Promise<DailyStats> {
  // Fetch from call_logs table (from 3CX webhook)
  // Only count calls with duration >= 30 seconds for talk time
  const callData = await queryOne<{ calls: string; seconds: string }>(
    `SELECT 
       COUNT(*) as calls,
       COALESCE(SUM(
         CASE 
           WHEN call_duration ~ '^[0-9]+:[0-9]+:[0-9]+$' THEN
             CASE WHEN (SPLIT_PART(call_duration, ':', 1)::int * 3600 +
                        SPLIT_PART(call_duration, ':', 2)::int * 60 +
                        SPLIT_PART(call_duration, ':', 3)::int) >= 30 THEN
               SPLIT_PART(call_duration, ':', 1)::int * 3600 +
               SPLIT_PART(call_duration, ':', 2)::int * 60 +
               SPLIT_PART(call_duration, ':', 3)::int
             ELSE 0 END
           WHEN call_duration ~ '^[0-9]+:[0-9]+$' THEN
             CASE WHEN (SPLIT_PART(call_duration, ':', 1)::int * 60 +
                        SPLIT_PART(call_duration, ':', 2)::int) >= 30 THEN
               SPLIT_PART(call_duration, ':', 1)::int * 60 +
               SPLIT_PART(call_duration, ':', 2)::int
             ELSE 0 END
           ELSE 0
         END
       ), 0) as seconds
     FROM call_logs 
     WHERE agent_extension = $1 AND call_time::date = $2`,
    [extensionNumber, date]
  );

  const calls = parseInt(callData?.calls || '0', 10);
  const seconds = parseInt(callData?.seconds || '0', 10);

  return upsertStats(userId, date, {
    calls_count: calls,
    talk_time_seconds: seconds,
  });
}

export async function getLeaderboard(date: string): Promise<DailyStatsWithUser[]> {
  return query<DailyStatsWithUser>(
    `SELECT d.*, u.full_name, u.extension_number 
     FROM daily_stats d
     JOIN users u ON d.user_id = u.id
     WHERE d.date = $1 AND u.role = 'agent' AND u.is_active = true
     ORDER BY d.calls_count DESC, d.talk_time_seconds DESC`,
    [date]
  );
}

export async function getMonthlyLeaderboard(year: number, month: number): Promise<{
  user_id: number;
  full_name: string;
  extension_number: string;
  total_calls: number;
  total_talk_time: number;
  total_leads: number;
}[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).toISOString().split('T')[0];

  return query(
    `SELECT 
       d.user_id,
       u.full_name,
       u.extension_number,
       COALESCE(SUM(d.calls_count), 0)::int as total_calls,
       COALESCE(SUM(d.talk_time_seconds), 0)::int as total_talk_time,
       COALESCE(SUM(d.leads_count), 0)::int as total_leads
     FROM daily_stats d
     JOIN users u ON d.user_id = u.id
     WHERE d.date BETWEEN $1 AND $2 AND u.role = 'agent' AND u.is_active = true
     GROUP BY d.user_id, u.full_name, u.extension_number
     ORDER BY total_calls DESC, total_talk_time DESC`,
    [startDate, endDate]
  );
}
