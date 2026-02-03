const API_BASE = '/api';

interface ApiResponse<T> {
  status: 'success' | 'error';
  data?: T;
  message?: string;
  hasMore?: boolean;
}

interface AttendanceInfo {
  isNewRecord: boolean;
  date: string;
  status: 'on_time' | 'late' | 'half_day';
  minutesLate?: number;
  message: string;
  checkInTime?: string;
}

interface LoginResponse {
  token: string;
  user: any;
  attendance: AttendanceInfo | null;
}

class ApiClient {
  private token: string | null = null;

  constructor() {
    // Load token from localStorage on init (client-side only)
    if (typeof window !== 'undefined') {
      this.token = localStorage.getItem('token');
    }
  }

  setToken(token: string | null) {
    this.token = token;
    if (typeof window !== 'undefined') {
      if (token) {
        localStorage.setItem('token', token);
      } else {
        localStorage.removeItem('token');
      }
    }
  }

  getToken(): string | null {
    return this.token;
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<ApiResponse<T>> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    };

    if (this.token) {
      (headers as Record<string, string>)['Authorization'] = `Bearer ${this.token}`;
    }

    try {
      const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers,
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.message || 'Request failed');
      }

      return data;
    } catch (error) {
      throw error;
    }
  }

  // Auth
  async login(username: string, password: string): Promise<ApiResponse<LoginResponse>> {
    const response = await this.request<LoginResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });

    if (response.data?.token) {
      this.setToken(response.data.token);
    }

    return response;
  }

  async logout() {
    this.setToken(null);
  }

  async getMe() {
    return this.request<any>('/auth/me');
  }

  // HR - Agents
  async getAgents() {
    return this.request<any[]>('/hr/agents');
  }

  async createAgent(data: {
    username: string;
    password: string;
    full_name: string;
    extension_number: string;
    base_salary: number;
    sales_target?: number;
    shift_start: string;
    shift_end: string;
    employment_type: 'full_time' | 'part_time';
  }) {
    return this.request<any>('/hr/agents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateAgent(id: number, data: {
    full_name?: string;
    username?: string;
    password?: string;
    extension_number?: string;
    base_salary?: number;
    sales_target?: number;
    shift_start?: string;
    shift_end?: string;
    employment_type?: 'full_time' | 'part_time';
    is_active?: boolean;
  }) {
    return this.request<any>(`/hr/agents/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  }

  async deleteAgent(id: number) {
    return this.request<any>(`/hr/agents/${id}`, {
      method: 'DELETE',
    });
  }

  async getPendingApprovals() {
    return this.request<any[]>('/hr/pending');
  }

  // Agent Stats
  async getAgentStats() {
    return this.request<any>('/agent/stats');
  }

  // Sync stats (placeholder - would trigger 3CX sync)
  async syncStats() {
    // For now, just return the stats
    return this.request<any>('/agent/stats');
  }

  // Leaderboard
  async getLeaderboard() {
    return this.request<any[]>('/leaderboard/daily');
  }

  async getMonthlyLeaderboard() {
    return this.request<any[]>('/leaderboard/monthly');
  }

  // Attendance - Agent
  async getMyAttendance() {
    return this.request<any>('/attendance');
  }

  async checkIn(status?: 'on_time' | 'late') {
    return this.request<any>('/attendance', {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  }

  async checkOut() {
    return this.request<any>('/attendance', {
      method: 'PUT',
    });
  }

  // Attendance - HR
  async getAttendanceByDate(date: string) {
    return this.request<any>(`/hr/attendance?date=${date}`);
  }

  async updateAttendance(id: number, data: { hr_approved?: boolean; status?: string; notes?: string }) {
    return this.request<any>('/hr/attendance', {
      method: 'PUT',
      body: JSON.stringify({ id, ...data }),
    });
  }

  // Daily Stats - HR
  async getDailyStats(date?: string) {
    const query = date ? `?date=${date}` : '';
    return this.request<any>(`/hr/daily-stats${query}`);
  }

  // Agent Leads - HR (fetch approved leads for an agent on a specific date)
  async getAgentLeads(agentId: number, date: string) {
    return this.request<any[]>(`/hr/agent-leads/${agentId}?date=${date}`);
  }

  // Add meeting time to agent's daily stats
  async addMeetingTime(agentId: number, date: string, durationMinutes: number, reason?: string) {
    return this.request<any>('/hr/stats/add-meeting', {
      method: 'POST',
      body: JSON.stringify({
        agentId,
        date,
        durationMinutes,
        reason: reason || null,
      }),
    });
  }

  // Power Dialer
  async getNextLead() {
    return this.request<any>('/dialer/next');
  }

  async initiateCall(leadId: number, agentExtension: string) {
    return this.request<any>('/dialer/call', {
      method: 'POST',
      body: JSON.stringify({ lead_id: leadId, agent_extension: agentExtension }),
    });
  }

  // Leads Management (Agent - own leads)
  async importMyLeads(leads: { name: string; phone_number: string; website?: string; notes?: string }[]) {
    return this.request<{ count: number }>('/agent/leads/import', {
      method: 'POST',
      body: JSON.stringify({ leads }),
    });
  }

  async getMyLeads() {
    return this.request<any[]>('/agent/leads/import');
  }

  // Leads Management (HR)
  async importLeads(agentId: number, leads: { name: string; phone_number: string; website?: string; notes?: string }[]) {
    return this.request<{ count: number }>('/hr/leads', {
      method: 'POST',
      body: JSON.stringify({ agent_id: agentId, leads }),
    });
  }

  async getLeads(agentId?: number) {
    const query = agentId ? `?agent_id=${agentId}` : '';
    return this.request<any[]>(`/hr/leads${query}`);
  }
}

export const api = new ApiClient();
