export interface DailyStats {
  id: number;
  user_id: number;
  date: string;
  calls_count: number;
  talk_time_seconds: number;
  leads_count: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyStatsWithUser extends DailyStats {
  user: {
    full_name: string;
    extension_number: string;
  };
}

export interface UpdateStatsDTO {
  calls_count?: number;
  talk_time_seconds?: number;
  leads_count?: number;
  notes?: string;
}

export interface AgentDashboardStats {
  today: {
    calls_count: number;
    talk_time_seconds: number;
    leads_count: number;
    earnings: number;
  };
  month: {
    total_calls: number;
    total_talk_time: number;
    total_leads: number;
    total_earnings: number;
    projected_salary: number;
    working_days_elapsed: number;
    working_days_total: number;
  };
  attendance: {
    on_time_days: number;
    late_days: number;
    half_days: number;
    absent_days: number;
  };
}

export interface LeaderboardEntry {
  rank: number;
  user_id: number;
  full_name: string;
  extension_number: string;
  total_calls: number;
  total_talk_time: number;
  total_leads: number;
  earnings: number;
}

export interface HRDashboardStats {
  agents_count: number;
  total_calls_today: number;
  total_talk_time_today: number;
  total_leads_today: number;
  pending_approvals: number;
  leaderboard: LeaderboardEntry[];
}
