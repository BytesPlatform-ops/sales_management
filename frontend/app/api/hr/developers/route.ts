import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** GET /api/hr/developers — developer accounts with their open projects. */
export const GET = handler(async (request: NextRequest) => {
  await requireHr(request);
  return ok(await query(
    `SELECT u.id, u.username, u.full_name, u.email_address AS email, COALESCE(u.is_active, true) AS is_active, u.created_at,
            (SELECT COUNT(*) FROM project_members m JOIN projects p ON p.id = m.project_id
             WHERE m.user_id = u.id AND p.status NOT IN ('delivered', 'closed', 'cancelled'))::int AS open_projects,
            (SELECT COUNT(*) FROM project_members m WHERE m.user_id = u.id)::int AS total_projects
     FROM users u WHERE u.role = 'developer' ORDER BY COALESCE(u.is_active, true) DESC, u.full_name`
  ));
});

/**
 * POST /api/hr/developers { username, password, full_name, email? }
 * Developers log in to the same app and only see Projects. They're never
 * part of agent payroll, leaderboards or lead distribution (those use role = 'agent').
 */
export const POST = handler(async (request: NextRequest) => {
  await requireHr(request);
  const b = await readJson(request);
  const username = String(b.username || '').trim();
  const fullName = String(b.full_name || '').trim();
  if (!username || !fullName || !b.password) throw new HttpError(400, 'Username, full name and password are required');
  if (username.length > 50) throw new HttpError(400, 'Username must be 50 characters or fewer');
  if (fullName.length > 100) throw new HttpError(400, 'Full name must be 100 characters or fewer');
  if (String(b.password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
  if (await queryOne(`SELECT 1 FROM users WHERE username = $1`, [username])) throw new HttpError(400, 'Username already exists');
  const hash = await bcrypt.hash(String(b.password), 10);
  // users requires a unique extension and a positive base_salary; developers don't use 3CX
  // or agent payroll, so they get a placeholder extension and a nominal salary.
  // extension_number is VARCHAR(20), so derive a fixed-length one from the (unique) username.
  const extension = `DEV-${createHash('md5').update(username).digest('hex').slice(0, 12)}`;
  const row = await queryOne(
    `INSERT INTO users (username, password, full_name, extension_number, base_salary, employment_type, role, is_active, email_address)
     VALUES ($1, $2, $3, $4, 1, 'full_time', 'developer', true, $5)
     RETURNING id, username, full_name, email_address AS email, is_active, created_at`,
    [username, hash, fullName, extension, b.email || null]
  );
  return ok(row);
});
