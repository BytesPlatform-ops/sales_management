/** CEO-only helpers: access checks, the sensitive-read log, privacy settings. */
import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { AuthCtx, AuthError, clientIp, verifyRequest } from './session';

/** The request must come from a CEO (not a view-as token). */
export async function requireCeo(request: NextRequest): Promise<AuthCtx> {
  let a: AuthCtx;
  try {
    a = await verifyRequest(request);
  } catch (e) {
    if (e instanceof AuthError) throw new HttpError(e.status, e.message);
    throw e;
  }
  if (a.role !== 'ceo' || a.readonly) throw new HttpError(403, 'CEO access required');
  return a;
}

export const isCeo = (a: Pick<AuthCtx, 'role' | 'readonly'>) => a.role === 'ceo' && !a.readonly;

/** canView: a CEO may read every module. (Writes are gated by Admin mode in verifyRequest.) */
export const canView = (role: string) => role === 'ceo' || role === 'hr';

export type AccessKind = 'vault_reveal' | 'payroll_person' | 'one_on_one' | 'dm' | 'view_as';

/** Record that a CEO looked at something sensitive. Never throws. */
export async function logCeoAccess(ceoId: number, kind: AccessKind, target: string, reason: string | null, request?: NextRequest | Request) {
  await query(
    `INSERT INTO ceo_access_log (ceo_id, kind, target, reason, ip) VALUES ($1, $2, $3, $4, $5)`,
    [ceoId, kind, target.slice(0, 500), reason?.slice(0, 1000) ?? null, request ? clientIp(request) : null]
  ).catch((err) => console.error('[ceo] access log', err));
}

/** For routes any HR-like viewer can call: log it when the viewer is a CEO. */
export async function logIfCeo(request: NextRequest | Request, kind: AccessKind, target: string, reason: string | null = null) {
  try {
    const a = await verifyRequest(request);
    if (a.role === 'ceo') await logCeoAccess(a.userId, kind, target, reason, request);
  } catch { /* the route's own auth decides */ }
}

// ------------------------------------------------------------------ privacy

export interface ChatVisibility { enabled: boolean; effective_at: string | null; notice_id?: number | null }

export async function chatVisibility(): Promise<ChatVisibility> {
  const r = await queryOne<{ value: ChatVisibility }>(`SELECT value FROM org_settings WHERE key = 'workplace_chat_visibility'`).catch(() => null);
  return r?.value ?? { enabled: false, effective_at: null };
}

/**
 * Private DMs are visible to CEOs only when the setting is on AND the staff notice
 * has been out long enough (effective_at has passed). Team chat (Phase 9) must call this.
 */
export async function ceoCanSeeDMs(now = new Date()): Promise<boolean> {
  const v = await chatVisibility();
  return !!v.enabled && !!v.effective_at && new Date(v.effective_at).getTime() <= now.getTime();
}

/** Hours between publishing the staff notice and the setting taking effect. */
export const NOTICE_LEAD_HOURS = 24;
