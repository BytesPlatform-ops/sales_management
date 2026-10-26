import { NextRequest } from 'next/server';
import bcrypt from 'bcryptjs';
import { queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** PATCH /api/hr/developers/{id} { full_name?, email?, is_active?, password? } */
export const PATCH = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  const b = await readJson(request);
  const sets: string[] = [];
  const vals: any[] = [];
  if (b.full_name) { vals.push(String(b.full_name).trim()); sets.push(`full_name = $${vals.length}`); }
  if ('email' in b) { vals.push(b.email || null); sets.push(`email_address = $${vals.length}`); }
  if ('is_active' in b) { vals.push(!!b.is_active); sets.push(`is_active = $${vals.length}`); }
  if (b.password) {
    if (String(b.password).length < 6) throw new HttpError(400, 'Password must be at least 6 characters');
    vals.push(await bcrypt.hash(String(b.password), 10)); sets.push(`password = $${vals.length}`);
  }
  if (!sets.length) throw new HttpError(400, 'Nothing to update');
  vals.push(Number(params.id));
  const row = await queryOne(
    `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length} AND role = 'developer'
     RETURNING id, username, full_name, email_address AS email, is_active`,
    vals
  );
  if (!row) throw new HttpError(404, 'Developer not found');
  return ok(row);
});
