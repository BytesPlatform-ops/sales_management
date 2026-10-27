'use client';

import { useEffect, useState } from 'react';
import { mediaUrl } from '@/components/tickets/lib';

/** Signed media URLs last 10 minutes; reuse them for 8 so a busy chat doesn't refetch every poll. */
const cache = new Map<string, { url: string; at: number }>();
const TTL = 8 * 60_000;

export async function signedUrl(id: string, download = false): Promise<string> {
  const k = `${id}:${download ? 'd' : 'v'}`;
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < TTL) return hit.url;
  const { url } = await mediaUrl(id, download);
  cache.set(k, { url, at: Date.now() });
  return url;
}

export function useSignedUrl(id: string | null, enabled = true): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    if (id && enabled) signedUrl(id).then((u) => { if (live) setUrl(u); }).catch(() => {});
    return () => { live = false; };
  }, [id, enabled]);
  return url;
}

export async function openDownload(id: string) {
  window.open(await signedUrl(id, true), '_blank', 'noopener');
}
