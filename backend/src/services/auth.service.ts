import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { findUserByUsername, verifyPassword, User } from './users.service';

export interface LoginResult {
  success: boolean;
  token?: string;
  user?: Omit<User, 'password'>;
  error?: string;
}

export async function login(username: string, password: string): Promise<LoginResult> {
  const user = await findUserByUsername(username);

  if (!user) {
    return { success: false, error: 'Invalid username or password' };
  }

  if (!user.is_active) {
    return { success: false, error: 'Account is deactivated' };
  }

  const isValidPassword = await verifyPassword(password, user.password);

  if (!isValidPassword) {
    return { success: false, error: 'Invalid username or password' };
  }

  const token = jwt.sign(
    {
      userId: user.id,
      username: user.username,
      role: user.role,
    },
    env.JWT_SECRET,
    { expiresIn: '7d' }
  );

  const { password: _, ...userWithoutPassword } = user;

  return {
    success: true,
    token,
    user: userWithoutPassword,
  };
}

export function verifyToken(token: string): { userId: number; username: string; role: 'hr' | 'agent' } | null {
  try {
    const decoded = jwt.verify(token, env.JWT_SECRET) as {
      userId: number;
      username: string;
      role: 'hr' | 'agent';
    };
    return decoded;
  } catch {
    return null;
  }
}
