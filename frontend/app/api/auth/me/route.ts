import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { AuthError, verifyRequest } from '@/lib/auth/session';

interface User {
  id: number;
  username: string;
  full_name: string;
  extension_number: string;
  role: 'hr' | 'agent' | 'developer' | 'ceo';
  base_salary: number;
  shift_start: string;
  shift_end: string;
  employment_type: string;
  is_active: boolean;
  created_at: string;
}

/**
 * GET /api/auth/me — the signed-in user, plus how they're signed in:
 * `view_as` (a CEO's read-only view of this user) and `admin_until` (CEO Admin mode).
 */
export async function GET(request: NextRequest) {
  let a;
  try {
    a = await verifyRequest(request);
  } catch (e) {
    const status = e instanceof AuthError ? e.status : 401;
    return NextResponse.json({ status: 'error', message: e instanceof AuthError ? e.message : 'Invalid or expired token' }, { status });
  }
  try {
    const user = await queryOne<User>(
      `SELECT id, username, full_name, extension_number, role, base_salary,
              shift_start, shift_end, employment_type, is_active, created_at, updated_at
       FROM users WHERE id = $1`,
      [a.userId]
    );
    if (!user || user.is_active === false) {
      return NextResponse.json({ status: 'error', message: 'User not found' }, { status: 404 });
    }
    let viewAs = null;
    if (a.viewAsBy) {
      const by = await queryOne<{ full_name: string }>(`SELECT full_name FROM users WHERE id = $1`, [a.viewAsBy]);
      viewAs = { by_id: a.viewAsBy, by_name: by?.full_name ?? 'CEO' };
    }
    return NextResponse.json({
      status: 'success',
      data: { ...user, view_as: viewAs, readonly: a.readonly, admin_until: a.adminActive ? a.adminUntil : null },
    });
  } catch (error) {
    console.error('Get me error:', error);
    return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 });
  }
}
