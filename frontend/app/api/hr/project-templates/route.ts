import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { parseTemplateBody, projectAsTemplateBody } from '@/lib/tickets/project-templates';
import { str } from '@/lib/tickets/input';

export const dynamic = 'force-dynamic';

/** GET /api/hr/project-templates — any signed-in user (the new-project form lists them). */
export const GET = handler(async (request: NextRequest) => {
  await getViewer(request);
  return ok(await query(
    `SELECT id, name, service_type, description, body, created_by IS NULL AS built_in, updated_at FROM project_templates ORDER BY name`
  ));
});

/**
 * POST /api/hr/project-templates { name, service_type?, description?, body } — HR.
 * Or { name, from_project_id } to save an existing project as a template.
 */
export const POST = handler(async (request: NextRequest) => {
  const hr = await requireHr(request);
  const b = await readJson(request);
  const body = b.from_project_id ? await projectAsTemplateBody(Number(b.from_project_id)) : parseTemplateBody(b.body);
  return ok(await queryOne(
    `INSERT INTO project_templates (name, service_type, description, body, created_by) VALUES ($1, $2, $3, $4::jsonb, $5)
     RETURNING id, name, service_type, description, body`,
    [str(b.name, 'Name', 100, true), b.service_type ? String(b.service_type).slice(0, 30) : null,
      str(b.description, 'Description', 2000) ?? '', JSON.stringify(body), hr.userId]
  ));
});
