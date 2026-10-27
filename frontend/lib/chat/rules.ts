/**
 * Chat rules shared by every message stream (project threads now, team channels
 * and DMs later). No database access.
 *
 *   edit      your own text/caption, within 15 minutes, not system messages
 *   delete    "delete for everyone": your own within 15 minutes; HR any time
 *   pin       anyone who can post in the stream
 *   forward   HR only
 *   read ✓✓   every other participant's read pointer has reached the message
 */
export const EDIT_WINDOW_MS = 15 * 60_000;
export const VOICE_MAX_SECONDS = 300;

export type MessageKind = 'message' | 'media' | 'voice' | 'system';

export interface ChatViewer { userId: number; role: 'hr' | 'agent' | 'developer' }
export interface ChatMessageFacts { user_id: number | string | null; created_at: string | Date; kind: MessageKind; deleted_at?: string | Date | null }

const withinWindow = (m: ChatMessageFacts, now: number) => now - new Date(m.created_at).getTime() <= EDIT_WINDOW_MS;
const isMine = (m: ChatMessageFacts, v: ChatViewer) => m.user_id != null && Number(m.user_id) === v.userId;

export function canEditMessage(m: ChatMessageFacts, v: ChatViewer, now = Date.now()): boolean {
  return !m.deleted_at && m.kind !== 'system' && m.kind !== 'voice' && isMine(m, v) && withinWindow(m, now);
}

export function canDeleteMessage(m: ChatMessageFacts, v: ChatViewer, now = Date.now()): boolean {
  if (m.deleted_at || m.kind === 'system') return false;
  if (v.role === 'hr') return true;
  return isMine(m, v) && withinWindow(m, now);
}

export const canForwardMessage = (v: ChatViewer) => v.role === 'hr';

/**
 * Read status for a message: 'read' when every participant except the author has
 * read up to it, otherwise 'sent'. `reads` maps user id → last read message id.
 */
export function readStatus(messageId: number, authorId: number | null, participants: number[], reads: Map<number, number>): 'sent' | 'read' {
  const others = participants.filter((p) => p !== authorId);
  if (!others.length) return 'sent';
  return others.every((p) => (reads.get(p) ?? 0) >= messageId) ? 'read' : 'sent';
}

export function seenBy(messageId: number, authorId: number | null, participants: number[], reads: Map<number, number>): number[] {
  return participants.filter((p) => p !== authorId && (reads.get(p) ?? 0) >= messageId);
}

/** Bare URLs in a message, for the "link card" (hostname + path; nothing is fetched). */
export function linksIn(text: string): { href: string; host: string; path: string }[] {
  const out: { href: string; host: string; path: string }[] = [];
  const re = /\bhttps?:\/\/[^\s<>"')\]]+/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) && out.length < 3) {
    try {
      const u = new URL(m[0]);
      out.push({ href: u.toString(), host: u.hostname.replace(/^www\./, ''), path: (u.pathname + u.search).slice(0, 80) });
    } catch { /* not a URL */ }
  }
  return out;
}

/** Downsample decoded audio to N peak bars (0–1) for the voice-note waveform. */
export function peaksFrom(samples: ArrayLike<number>, bars = 48): number[] {
  const n = samples.length;
  if (!n) return Array(bars).fill(0);
  const size = Math.max(1, Math.floor(n / bars));
  const out: number[] = [];
  let max = 0;
  for (let b = 0; b < bars; b++) {
    let peak = 0;
    for (let i = b * size; i < Math.min(n, (b + 1) * size); i++) peak = Math.max(peak, Math.abs(samples[i]));
    out.push(peak);
    max = Math.max(max, peak);
  }
  return out.map((p) => (max ? Math.round((p / max) * 100) / 100 : 0));
}

/** Validate client-supplied voice meta: duration ≤ 5 min, ≤ 128 peaks in 0–1. */
export function cleanVoiceMeta(v: unknown): { duration: number; peaks: number[] } | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as any;
  const duration = Number(o.duration);
  if (!Number.isFinite(duration) || duration <= 0 || duration > VOICE_MAX_SECONDS + 1) return null;
  const peaks = Array.isArray(o.peaks) ? o.peaks.slice(0, 128).map((p: unknown) => Math.min(1, Math.max(0, Number(p) || 0))) : [];
  return { duration: Math.round(duration * 10) / 10, peaks };
}
