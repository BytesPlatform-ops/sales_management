import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { requireCeo } from '@/lib/auth/ceo';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

async function target(id: number) {
  const u = await queryOne<{ id: string; is_active: boolean | null }>(`SELECT id, is_active FROM users WHERE id = $1 AND role = 'ceo'`, [id]);
  if (!u) throw new HttpError(404, 'CEO account not found');
  return u;
}

/** PATCH /api/ceo/users/{id} { full_name?, email?, is_active? } — Admin mode. */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  await requireCeo(request);
  const u = await target(Number(params.id));
  const b = await readJson(request);
  if (b.is_active === false) await assertNotLastCeo(Number(u.id));
  await query(
    `UPDATE users SET full_name = COALESCE($2, full_name), email_address = COALESCE($3, email_address),
            is_active = COALESCE($4, is_active), updated_at = NOW() WHERE id = $1`,
    [u.id, b.full_name ? String(b.full_name).trim().slice(0, 100) : null, b.email ? String(b.email).trim().slice(0, 200) : null,
      typeof b.is_active === 'boolean' ? b.is_active : null]
  );
  if (b.is_active === false) await query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [u.id]);
  return ok({ id: Number(u.id) });
});

/** DELETE /api/ceo/users/{id} — deactivate (Admin mode). The last active CEO can't be removed. */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  await requireCeo(request);
  const u = await target(Number(params.id));
  await assertNotLastCeo(Number(u.id));
  await query(`UPDATE users SET is_active = false, updated_at = NOW() WHERE id = $1`, [u.id]);
  await query(`UPDATE user_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [u.id]);
  return ok({ deactivated: Number(u.id) });
});

async function assertNotLastCeo(id: number) {
  const r = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'ceo' AND COALESCE(is_active, true) AND id <> $1`, [id]);
  if (!r || r.n === 0) throw new HttpError(400, 'At least one active CEO account must remain');
}
