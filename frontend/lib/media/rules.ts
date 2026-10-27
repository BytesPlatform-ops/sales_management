/**
 * Upload rules with no I/O: size limit, file kind, and which files may be shown
 * inline. Anything that could run script in our origin (HTML, SVG, JS, XML…)
 * is only ever served as a download.
 */
export const DEFAULT_MAX_MB = 50;

export function maxUploadBytes(): number {
  const mb = Number(process.env.MEDIA_MAX_MB);
  return Math.round((Number.isFinite(mb) && mb > 0 ? mb : DEFAULT_MAX_MB) * 1024 * 1024);
}

export type MediaKind = 'image' | 'video' | 'audio' | 'pdf' | 'file';

const INLINE_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i;
const INLINE_VIDEO = /^video\/(mp4|webm|ogg|quicktime)$/i;
const INLINE_AUDIO = /^audio\/(mpeg|mp3|mp4|aac|ogg|wav|x-wav|webm|x-m4a|m4a|flac)$/i;

export function kindOf(mime: string): MediaKind {
  if (INLINE_IMAGE.test(mime)) return 'image';
  if (INLINE_VIDEO.test(mime)) return 'video';
  if (INLINE_AUDIO.test(mime)) return 'audio';
  if (/^application\/pdf$/i.test(mime)) return 'pdf';
  return 'file';
}

/** Only these open in the browser; everything else (incl. image/svg+xml, text/html) downloads. */
export function isInlineSafe(mime: string): boolean {
  return kindOf(mime) !== 'file';
}

/** A storage-safe file name: keeps the extension, drops path parts and odd characters. */
export function safeFileName(name: string): string {
  const base = String(name || 'file').split(/[\\/]/).pop()!.normalize('NFKD');
  const cleaned = base.replace(/[^A-Za-z0-9._ -]+/g, '').replace(/\s+/g, '-').replace(/^[.-]+/, '').slice(-120);
  return cleaned || 'file';
}

/** Mime as declared by the browser, trimmed to something sane. */
export function normalizeMime(mime: unknown): string {
  // Drop parameters: "audio/webm;codecs=opus" → "audio/webm", "text/html; charset=utf-8" → "text/html".
  const m = String(mime || '').toLowerCase().split(';')[0].trim();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(m) ? m.slice(0, 150) : 'application/octet-stream';
}

export const ENTITY_TYPES = ['project', 'ticket', 'ticket_comment', 'meeting', 'brief_entry', 'message', 'work_update'] as const;
export type MediaEntity = (typeof ENTITY_TYPES)[number];
export const isMediaEntity = (v: unknown): v is MediaEntity => typeof v === 'string' && (ENTITY_TYPES as readonly string[]).includes(v);

/** Project, ticket and brief files need a description; comment/meeting/chat attachments don't. */
export const descriptionRequired = (entity: MediaEntity) => entity === 'project' || entity === 'ticket' || entity === 'brief_entry';

export const RESTORE_DAYS = 30;
