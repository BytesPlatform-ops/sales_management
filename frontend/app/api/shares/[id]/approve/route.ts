import { NextRequest } from 'next/server';
import { handler, ok } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { approveShare, loadGrant } from '@/lib/collab/shares';

export const dynamic = 'force-dynamic';

/** POST /api/shares/{id}/approve — HR approves a Production Env share. */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  await approveShare(v, await loadGrant(Number(params.id)));
  return ok({ approved: Number(params.id) });
});
