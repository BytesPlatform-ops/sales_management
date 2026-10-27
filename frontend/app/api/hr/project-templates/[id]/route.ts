import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, HttpError } from '@/lib/training/http';
import { parseTemplateBody } from '@/lib/tickets/project-templates';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

/** PATCH /api/hr/project-templates/{id} { name?, service_type?, description?, body? } */
export const PATCH = handler(async (request: NextRequest, { params }: Ctx) => {
  await requireHr(request);
  const b = await readJson(request);
  const cur = await queryOne(`SELECT id FROM project_templates WHERE id = $1`, [Number(params.id)]);
  if (!cur) throw new HttpError(404, 'Template not found');
  await query(
    `UPDATE project_templates SET name = COALESCE($2, name), service_type = COALESCE($3, service_type),
            description = COALESCE($4, description), body = COALESCE($5::jsonb, body), updated_at = NOW() WHERE id = $1`,
    [cur.id, b.name !== undefined ? str(b.name, 'Name', 100, true) : null, b.service_type ?? null,
      b.description !== undefined ? str(b.description, 'Description', 2000) : null,
      b.body !== undefined ? JSON.stringify(parseTemplateBody(b.body)) : null]
  );
  return ok({ id: cur.id });
});

/** DELETE /api/hr/project-templates/{id} */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  await requireHr(request);
  await query(`DELETE FROM project_templates WHERE id = $1`, [Number(params.id)]);
  return ok({ deleted: Number(params.id) });
});
