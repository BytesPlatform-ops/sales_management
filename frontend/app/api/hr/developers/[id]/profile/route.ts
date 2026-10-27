import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { cleanSkills } from '@/lib/collab/help';

export const dynamic = 'force-dynamic';

/**
 * PUT /api/hr/developers/{id}/profile { is_guest?, guest_expires_at?, skills?, weekly_capacity_hours? } — HR.
 * Guests (freelancers) only see projects they're explicitly put on or shared, are never
 * auto-picked, and lose all access after guest_expires_at.
 */
export const PUT = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  await requireHr(request);
  const id = Number(params.id);
  const u = await queryOne<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id]);
  if (!u || u.role !== 'developer') throw new HttpError(404, 'Developer not found');
  const b = await readJson(request);
  let expires: string | null | undefined;
  if (b.guest_expires_at !== undefined) {
    expires = b.guest_expires_at ? new Date(String(b.guest_expires_at)).toISOString() : null;
  }
  await query(
    `INSERT INTO developer_profiles (user_id, is_guest, guest_expires_at, skills, weekly_capacity_hours)
     VALUES ($1, COALESCE($2, false), $3, COALESCE($4::text[], '{}'), $5)
     ON CONFLICT (user_id) DO UPDATE SET
       is_guest = COALESCE($2, developer_profiles.is_guest),
       guest_expires_at = CASE WHEN $6 THEN $3 ELSE developer_profiles.guest_expires_at END,
       skills = COALESCE($4::text[], developer_profiles.skills),
       weekly_capacity_hours = COALESCE($5, developer_profiles.weekly_capacity_hours),
       updated_at = NOW()`,
    [id, typeof b.is_guest === 'boolean' ? b.is_guest : null, expires ?? null, b.skills === undefined ? null : cleanSkills(b.skills),
      b.weekly_capacity_hours == null || b.weekly_capacity_hours === '' ? null : Math.round(Number(b.weekly_capacity_hours)), expires !== undefined]
  );
  return ok(await queryOne(`SELECT user_id, is_guest, guest_expires_at, skills, weekly_capacity_hours FROM developer_profiles WHERE user_id = $1`, [id]));
});
