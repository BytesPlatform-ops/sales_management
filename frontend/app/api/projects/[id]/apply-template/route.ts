import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { getViewer, loadProject, requireSupervisor, systemMessage } from '@/lib/projects/core';
import { applyProjectTemplate } from '@/lib/tickets/project-templates';

export const dynamic = 'force-dynamic';

/** POST /api/projects/{id}/apply-template { template_id } — HR. Adds the template's epics, tickets, milestones. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  requireSupervisor(v);
  const p = await loadProject(Number(params.id), v);
  const r = await applyProjectTemplate(p.id, Number((await readJson(request)).template_id), v.userId);
  await systemMessage(p.id, `${v.name} applied a project template: ${r.epics} epics, ${r.tickets} tickets, ${r.milestones} milestones.`, v.userId);
  return ok(r);
});
