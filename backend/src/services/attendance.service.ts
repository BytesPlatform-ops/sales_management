import { query, queryOne } from '../config/database';

export interface Attendance {
  id: number;
  user_id: number;
  date: string;
  check_in_time: Date | null;
  check_out_time: Date | null;
  status: 'on_time' | 'late' | 'half_day' | 'absent';
  hr_approved: boolean;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface AttendanceWithUser extends Attendance {
  full_name: string;
  extension_number: string;
}

export async function getAttendanceByUserAndDate(
  userId: number,
  date: string
): Promise<Attendance | null> {
  return queryOne<Attendance>(
    'SELECT * FROM attendance WHERE user_id = $1 AND date = $2',
    [userId, date]
  );
}

export async function getAttendanceByDate(date: string): Promise<AttendanceWithUser[]> {
  return query<AttendanceWithUser>(
    `SELECT a.*, u.full_name, u.extension_number 
     FROM attendance a
     JOIN users u ON a.user_id = u.id
     WHERE a.date = $1
     ORDER BY u.full_name`,
    [date]
  );
}

export async function getAttendanceByUser(
  userId: number,
  startDate?: string,
  endDate?: string
): Promise<Attendance[]> {
  if (startDate && endDate) {
    return query<Attendance>(
      'SELECT * FROM attendance WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date DESC',
      [userId, startDate, endDate]
    );
  }
  return query<Attendance>(
    'SELECT * FROM attendance WHERE user_id = $1 ORDER BY date DESC LIMIT 30',
    [userId]
  );
}

export async function getMonthlyAttendance(
  userId: number,
  year: number,
  month: number
): Promise<Attendance[]> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).toISOString().split('T')[0];

  return query<Attendance>(
    'SELECT * FROM attendance WHERE user_id = $1 AND date BETWEEN $2 AND $3 ORDER BY date',
    [userId, startDate, endDate]
  );
}

export async function getAttendanceSummary(
  userId: number,
  year: number,
  month: number
): Promise<{ on_time: number; late: number; half_day: number; absent: number }> {
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  const endDate = new Date(year, month, 0).toISOString().split('T')[0];

  const result = await queryOne<{
    on_time: string;
    late: string;
    half_day: string;
    absent: string;
  }>(
    `SELECT 
       COUNT(*) FILTER (WHERE status = 'on_time') as on_time,
       COUNT(*) FILTER (WHERE status = 'late') as late,
       COUNT(*) FILTER (WHERE status = 'half_day') as half_day,
       COUNT(*) FILTER (WHERE status = 'absent') as absent
     FROM attendance 
     WHERE user_id = $1 AND date BETWEEN $2 AND $3`,
    [userId, startDate, endDate]
  );

  return {
    on_time: parseInt(result?.on_time || '0', 10),
    late: parseInt(result?.late || '0', 10),
    half_day: parseInt(result?.half_day || '0', 10),
    absent: parseInt(result?.absent || '0', 10),
  };
}

export async function checkIn(
  userId: number,
  status: 'on_time' | 'late',
  date?: string
): Promise<Attendance> {
  const checkInDate = date || new Date().toISOString().split('T')[0];
  const checkInTime = new Date();

  const result = await queryOne<Attendance>(
    `INSERT INTO attendance (user_id, date, check_in_time, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (user_id, date) 
     DO UPDATE SET check_in_time = $3, status = $4, updated_at = CURRENT_TIMESTAMP
     RETURNING *`,
    [userId, checkInDate, checkInTime, status]
  );

  if (!result) {
    throw new Error('Failed to check in');
  }

  return result;
}

export async function checkOut(userId: number, date?: string): Promise<Attendance | null> {
  const checkOutDate = date || new Date().toISOString().split('T')[0];
  const checkOutTime = new Date();

  return queryOne<Attendance>(
    `UPDATE attendance 
     SET check_out_time = $1, updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $2 AND date = $3
     RETURNING *`,
    [checkOutTime, userId, checkOutDate]
  );
}

export async function updateAttendance(
  id: number,
  updates: Partial<{
    status: 'on_time' | 'late' | 'half_day' | 'absent';
    hr_approved: boolean;
    notes: string;
  }>
): Promise<Attendance | null> {
  const setClauses: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  for (const [key, value] of Object.entries(updates)) {
    if (value !== undefined) {
      setClauses.push(`${key} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  }

  if (setClauses.length === 0) {
    return null;
  }

  setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  return queryOne<Attendance>(
    `UPDATE attendance SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );
}

export async function getPendingApprovals(): Promise<AttendanceWithUser[]> {
  return query<AttendanceWithUser>(
    `SELECT a.*, u.full_name, u.extension_number 
     FROM attendance a
     JOIN users u ON a.user_id = u.id
     WHERE a.hr_approved = false
     ORDER BY a.date DESC`
  );
}
