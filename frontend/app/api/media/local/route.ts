import { NextRequest } from 'next/server';
import { promises as fs } from 'fs';
import path from 'path';
import { handler, ok, HttpError } from '@/lib/training/http';
import { isInlineSafe } from '@/lib/media/rules';
import { localFile, mediaStorage, readLocalToken } from '@/lib/media/storage';

export const dynamic = 'force-dynamic';

function requireLocal() {
  if (mediaStorage().name !== 'local') throw new HttpError(404, 'Not found');
}

/** PUT /api/media/local?t= — development stand-in for a signed Supabase upload. */
export const PUT = handler(async (request: NextRequest) => {
  requireLocal();
  const c = await readLocalToken(new URL(request.url).searchParams.get('t') || '', 'media-up');
  const buf = Buffer.from(await request.arrayBuffer());
  if (c.max && buf.length > c.max) throw new HttpError(413, 'File too large');
  const file = localFile(c.p);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, buf, { flag: 'wx' }).catch((e) => {
    if (e.code === 'EEXIST') throw new HttpError(409, 'Already uploaded');
    throw e;
  });
  return ok({ size: buf.length });
});

/** GET /api/media/local?t= — development stand-in for a signed Supabase download. */
export const GET = handler(async (request: NextRequest) => {
  requireLocal();
  const c = await readLocalToken(new URL(request.url).searchParams.get('t') || '', 'media-down');
  const buf = await fs.readFile(localFile(c.p)).catch(() => { throw new HttpError(404, 'File not found'); });
  const mime = c.mime || 'application/octet-stream';
  const attach = c.dl || !isInlineSafe(mime);
  const name = (c.name || 'file').replace(/["\r\n]/g, '');
  return new Response(buf, {
    headers: {
      'Content-Type': attach ? 'application/octet-stream' : mime,
      'Content-Disposition': `${attach ? 'attachment' : 'inline'}; filename="${name}"; filename*=UTF-8''${encodeURIComponent(c.name || 'file')}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=600',
    },
  });
});
