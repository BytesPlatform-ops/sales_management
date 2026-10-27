import { NextRequest } from 'next/server';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { acceptHelp, cancelHelp, declineHelp, extendHelp, loadHelp } from '@/lib/collab/help';

export const dynamic = 'force-dynamic';

/** POST /api/help-requests/{id} { action: 'accept' | 'decline' | 'cancel' | 'extend', days? } */
export const POST = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const v = await getViewer(request);
  const h = await loadHelp(Number(params.id));
  const b = await readJson(request).catch(() => ({}));
  switch (b.action) {
    case 'accept': return ok(await acceptHelp(h, v, b.days));
    case 'decline': return ok(await declineHelp(h, v));
    case 'cancel': return ok(await cancelHelp(h, v));
    case 'extend': return ok(await extendHelp(h, v, b.days));
    default: throw new HttpError(400, 'action must be accept, decline, cancel or extend');
  }
});
