/** Helpers for /api/inbox: ids are "n<id>" (notifications_inbox) or "t<id>" (training_notifications). */

/** Split "n12"/"t7" ids into inbox and training ids. */
export function splitIds(ids: unknown): { inbox: number[]; training: number[] } {
  const out = { inbox: [] as number[], training: [] as number[] };
  if (!Array.isArray(ids)) return out;
  for (const raw of ids) {
    const m = /^([nt])(\d+)$/.exec(String(raw));
    if (m) (m[1] === 'n' ? out.inbox : out.training).push(Number(m[2]));
  }
  return out;
}
