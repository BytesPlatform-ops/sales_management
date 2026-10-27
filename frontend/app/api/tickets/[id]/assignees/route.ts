import { NextRequest } from 'next/server';
import { handler, ok, readJson } from '@/lib/training/http';
import { ticketCtx } from '@/lib/tickets/core';
import { setAssignees } from '@/lib/tickets/update';

export const dynamic = 'force-dynamic';

/** PUT /api/tickets/{id}/assignees { user_ids: [], handoff?: {done, left, branch?, gotchas?} } — replace assignees (project developers only). */
export const PUT = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const ctx = await ticketCtx(request, Number(params.id));
  const b = await readJson(request);
  return ok({ user_ids: await setAssignees(ctx, b.user_ids, 'replace', b.handoff) });
});
