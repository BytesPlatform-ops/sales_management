export type AttendanceStatus = 'on_time' | 'late' | 'half_day' | 'absent';

export interface Attendance {
  id: number;
  user_id: number;
  date: string; // DATE as ISO string
  check_in_time: string | null;
  check_out_time: string | null;
  status: AttendanceStatus;
  hr_approved: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AttendanceWithUser extends Attendance {
  user: {
    full_name: string;
    extension_number: string;
  };
}

export interface CheckInDTO {
  user_id: number;
  date?: string; // Optional, defaults to today
}

export interface CheckOutDTO {
  user_id: number;
  date?: string;
}

export interface UpdateAttendanceDTO {
  status?: AttendanceStatus;
  hr_approved?: boolean;
  notes?: string;
}

export interface AttendanceSummary {
  total_days: number;
  on_time: number;
  late: number;
  half_day: number;
  absent: number;
  pending_approval: number;
}
