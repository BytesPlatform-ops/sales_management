import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { str, typeOf } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

/** PATCH /api/ticket-templates/{id} — HR. */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  await requireHr(request);
  const b = await readJson(request);
  const cur = await queryOne(`SELECT id FROM ticket_templates WHERE id = $1`, [Number(params.id)]);
  if (!cur) throw new HttpError(404, 'Template not found');
  const set: Record<string, unknown> = {};
  if (b.name !== undefined) set.name = str(b.name, 'Name', 100, true);
  if (b.type !== undefined) set.type = typeOf(b.type);
  if (b.title_prefix !== undefined) set.title_prefix = str(b.title_prefix, 'Title prefix', 100) ?? '';
  if (b.description !== undefined) set.description = str(b.description, 'Description', 20_000) ?? '';
  if (b.checklist !== undefined) set.checklist = JSON.stringify((Array.isArray(b.checklist) ? b.checklist : []).map((s: unknown) => String(s).trim()).filter(Boolean));
  if (b.require_attachment !== undefined) set.require_attachment = !!b.require_attachment;
  const keys = Object.keys(set);
  if (keys.length) {
    await query(`UPDATE ticket_templates SET ${keys.map((k, i) => `${k} = $${i + 2}${k === 'checklist' ? '::jsonb' : ''}`).join(', ')}, updated_at = NOW() WHERE id = $1`,
      [cur.id, ...keys.map((k) => set[k])]);
  }
  return ok({ id: cur.id });
});

/** DELETE /api/ticket-templates/{id} — HR. */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  await requireHr(request);
  await query(`DELETE FROM ticket_templates WHERE id = $1`, [Number(params.id)]);
  return ok({ deleted: Number(params.id) });
});
