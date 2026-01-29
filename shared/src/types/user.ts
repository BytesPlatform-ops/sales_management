export type UserRole = 'hr' | 'agent';
export type EmploymentType = 'full_time' | 'part_time';

export interface User {
  id: number;
  username: string;
  full_name: string;
  extension_number: string;
  role: UserRole;
  base_salary: number;
  shift_start: string; // TIME as string "HH:MM:SS"
  shift_end: string;
  employment_type: EmploymentType;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface UserWithDailyPotential extends User {
  daily_potential: number; // base_salary / working_days_in_month
}

export interface CreateUserDTO {
  username: string;
  password: string;
  full_name: string;
  extension_number: string;
  role: UserRole;
  base_salary: number;
  shift_start?: string;
  shift_end?: string;
  employment_type?: EmploymentType;
}

export interface UpdateUserDTO {
  full_name?: string;
  extension_number?: string;
  base_salary?: number;
  shift_start?: string;
  shift_end?: string;
  employment_type?: EmploymentType;
  is_active?: boolean;
}

export interface LoginDTO {
  username: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user: Omit<User, 'password'>;
}

export interface JWTPayload {
  userId: number;
  username: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}
