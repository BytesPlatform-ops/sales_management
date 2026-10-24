'use client';

/**
 * Browser helpers for the training screens. Same token handling as
 * lib/api-client.ts (JWT in localStorage), but returns `data` directly and
 * throws Error(message) on failure so pages can show the server's message.
 */
import useSWR, { SWRConfiguration } from 'swr';

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: any) {
    super(message);
  }
}

function token() {
  return typeof window === 'undefined' ? null : localStorage.getItem('token');
}

export async function tapi<T = any>(path: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  const res = await fetch(`/api/training${path}`, { method: opts.method || (body ? 'POST' : 'GET'), headers, body, cache: 'no-store' });
  let json: any = null;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, `Request failed (${res.status})`);
  }
  if (!res.ok || json?.status === 'error') throw new ApiError(res.status, json?.message || 'Request failed', json);
  return json.data as T;
}

/** SWR hook over tapi. Pass null to skip. */
export function useTraining<T = any>(path: string | null, config?: SWRConfiguration) {
  return useSWR<T>(path, (p: string) => tapi<T>(p), { revalidateOnFocus: false, ...config });
}

/** Authenticated URL for <audio src> (the audio route accepts ?token=). */
export function authedUrl(path: string) {
  const t = token();
  return `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(t || '')}`;
}

export const SERVICE_LABELS: Record<string, string> = {
  website_new: 'New website',
  revamp: 'Website revamp',
  seo: 'SEO',
  smm: 'Social media',
  automation: 'Automation / AI receptionist',
  contract_mgmt: 'Contract-mgmt build (Bytescon)',
  exit: 'Polite exit',
};

export const PHASE_LABELS: Record<string, string> = {
  TRAINING: 'Training',
  SUPERVISED: 'Supervised',
  RAMP_50: 'Ramp 50%',
  RAMP_75: 'Ramp 75%',
  FULL: 'Full quota',
};

export function fmtDate(d: string | Date | null | undefined, withTime = false) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-US', withTime
    ? { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }
    : { month: 'short', day: 'numeric', year: 'numeric' });
}
