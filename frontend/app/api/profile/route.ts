import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { cleanSkills } from '@/lib/collab/help';

export const dynamic = 'force-dynamic';

/** GET /api/profile — your skills, time zone, weekly capacity, guest status and out-of-office dates. */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const p = await queryOne(
    `SELECT skills, timezone, weekly_capacity_hours, is_guest, guest_expires_at FROM developer_profiles WHERE user_id = $1`, [v.userId]
  );
  const ooo = await query(
    `SELECT id, starts_on::text AS starts_on, ends_on::text AS ends_on, note FROM user_availability
      WHERE user_id = $1 AND ends_on >= (NOW() AT TIME ZONE 'Asia/Karachi')::date - 30 ORDER BY starts_on`, [v.userId]
  );
  return ok({
    user_id: v.userId, name: v.name, role: v.role,
    profile: p || { skills: [], timezone: 'Asia/Karachi', weekly_capacity_hours: null, is_guest: false, guest_expires_at: null },
    out_of_office: ooo,
  });
});

/** PUT /api/profile { skills?, timezone?, weekly_capacity_hours? } — guest status is HR's to set. */
export const PUT = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const b = await readJson(request);
  const tz = b.timezone === undefined ? undefined : String(b.timezone).slice(0, 50);
  if (tz !== undefined && !/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+)*$/.test(tz)) throw new HttpError(400, 'Unknown time zone');
  const cap = b.weekly_capacity_hours === undefined || b.weekly_capacity_hours === null || b.weekly_capacity_hours === ''
    ? (b.weekly_capacity_hours === undefined ? undefined : null) : Number(b.weekly_capacity_hours);
  if (typeof cap === 'number' && (!Number.isFinite(cap) || cap < 0 || cap > 80)) throw new HttpError(400, 'Capacity must be 0–80 hours a week');
  await query(
    `INSERT INTO developer_profiles (user_id, skills, timezone, weekly_capacity_hours)
     VALUES ($1, COALESCE($2::text[], '{}'), COALESCE($3, 'Asia/Karachi'), $4)
     ON CONFLICT (user_id) DO UPDATE SET
       skills = COALESCE($2::text[], developer_profiles.skills),
       timezone = COALESCE($3, developer_profiles.timezone),
       weekly_capacity_hours = CASE WHEN $5 THEN $4 ELSE developer_profiles.weekly_capacity_hours END,
       updated_at = NOW()`,
    [v.userId, b.skills === undefined ? null : cleanSkills(b.skills), tz ?? null, typeof cap === 'number' ? Math.round(cap) : null, cap !== undefined]
  );
  return ok({ saved: true });
});
