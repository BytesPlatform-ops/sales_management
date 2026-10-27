import { NextRequest } from 'next/server';
import { handler, ok } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { loadGrant, revokeShare } from '@/lib/collab/shares';

export const dynamic = 'force-dynamic';

/** DELETE /api/shares/{id} — the sharer, the recipient or HR ends it now. */
export const DELETE = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  await revokeShare(v, await loadGrant(Number(params.id)));
  return ok({ revoked: Number(params.id) });
});
