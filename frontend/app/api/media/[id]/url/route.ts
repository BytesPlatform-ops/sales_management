import { NextRequest, NextResponse } from 'next/server';
import { handler, HttpError } from '@/lib/training/http';
import { loadMedia } from '@/lib/media/access';
import { isInlineSafe } from '@/lib/media/rules';
import { mediaStorage } from '@/lib/media/storage';

export const dynamic = 'force-dynamic';

/**
 * GET /api/media/{id}/url?download=1 → { url, inline } — a link that works for 10 minutes.
 * Files that could run script (HTML, SVG, JS, …) are always served as downloads.
 */
export const GET = handler(async (request: NextRequest, { params }: { params: { id: string } }) => {
  const { media: m } = await loadMedia(request, params.id);
  if (m.status !== 'ready') throw new HttpError(409, 'Still uploading');
  const inline = isInlineSafe(m.mime_type);
  const download = !inline || new URL(request.url).searchParams.get('download') === '1';
  const url = await mediaStorage().signedUrl(m.storage_path, { fileName: m.file_name, mime: m.mime_type, download, ttlSeconds: 600 });
  return NextResponse.json({ status: 'success', data: { url, inline: inline && !download } }, { headers: { 'Cache-Control': 'no-store' } });
});
