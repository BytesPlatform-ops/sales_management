import { query, queryOne } from '../config/database';
import bcrypt from 'bcryptjs';

export interface User {
  id: number;
  username: string;
  password: string;
  full_name: string;
  extension_number: string;
  role: 'hr' | 'agent';
  base_salary: number;
  shift_start: string;
  shift_end: string;
  employment_type: 'full_time' | 'part_time';
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type UserWithoutPassword = Omit<User, 'password'>;

export async function findUserByUsername(username: string): Promise<User | null> {
  return queryOne<User>('SELECT * FROM users WHERE username = $1', [username]);
}

export async function findUserById(id: number): Promise<UserWithoutPassword | null> {
  return queryOne<UserWithoutPassword>(
    `SELECT id, username, full_name, extension_number, role, base_salary, 
            shift_start, shift_end, employment_type, is_active, created_at, updated_at 
     FROM users WHERE id = $1`,
    [id]
  );
}

export async function findUserByExtension(extension: string): Promise<UserWithoutPassword | null> {
  return queryOne<UserWithoutPassword>(
    `SELECT id, username, full_name, extension_number, role, base_salary, 
            shift_start, shift_end, employment_type, is_active, created_at, updated_at 
     FROM users WHERE extension_number = $1`,
    [extension]
  );
}

export async function getAllAgents(): Promise<UserWithoutPassword[]> {
  return query<UserWithoutPassword>(
    `SELECT id, username, full_name, extension_number, role, base_salary, 
            shift_start, shift_end, employment_type, is_active, created_at, updated_at 
     FROM users WHERE role = 'agent' AND is_active = true
     ORDER BY full_name`
  );
}

export async function getAllUsers(): Promise<UserWithoutPassword[]> {
  return query<UserWithoutPassword>(
    `SELECT id, username, full_name, extension_number, role, base_salary, 
            shift_start, shift_end, employment_type, is_active, created_at, updated_at 
     FROM users ORDER BY role, full_name`
  );
}

export async function createUser(userData: {
  username: string;
  password: string;
  full_name: string;
  extension_number: string;
  role: 'hr' | 'agent';
  base_salary: number;
  shift_start?: string;
  shift_end?: string;
  employment_type?: 'full_time' | 'part_time';
}): Promise<UserWithoutPassword> {
  const hashedPassword = await bcrypt.hash(userData.password, 10);

  const result = await queryOne<UserWithoutPassword>(
    `INSERT INTO users (username, password, full_name, extension_number, role, base_salary, shift_start, shift_end, employment_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, username, full_name, extension_number, role, base_salary, shift_start, shift_end, employment_type, is_active, created_at, updated_at`,
    [
      userData.username,
      hashedPassword,
      userData.full_name,
      userData.extension_number,
      userData.role,
      userData.base_salary,
      userData.shift_start || '09:00:00',
      userData.shift_end || '18:00:00',
      userData.employment_type || 'full_time',
    ]
  );

  if (!result) {
    throw new Error('Failed to create user');
  }

  return result;
}

export async function updateUser(
  id: number,
  updates: Partial<{
    full_name: string;
    extension_number: string;
    base_salary: number;
    shift_start: string;
    shift_end: string;
    employment_type: 'full_time' | 'part_time';
    is_active: boolean;
  }>
): Promise<UserWithoutPassword | null> {
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
    return findUserById(id);
  }

  setClauses.push(`updated_at = CURRENT_TIMESTAMP`);
  values.push(id);

  return queryOne<UserWithoutPassword>(
    `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
     RETURNING id, username, full_name, extension_number, role, base_salary, shift_start, shift_end, employment_type, is_active, created_at, updated_at`,
    values
  );
}

export async function verifyPassword(plainPassword: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(plainPassword, hashedPassword);
}
