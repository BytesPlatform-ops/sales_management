/**
 * Shared request helpers for the training module's API routes.
 * Same JWT contract as the rest of the app: role 'hr' = trainer/admin, 'agent' = rep.
 */
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

export interface AuthUser {
  userId: number;
  username: string;
  role: 'hr' | 'agent';
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function getAuth(request: NextRequest): Promise<AuthUser> {
  const header = request.headers.get('authorization');
  if (!header || !header.startsWith('Bearer ')) throw new HttpError(401, 'No token provided');
  try {
    const { payload } = await jwtVerify(header.split(' ')[1], JWT_SECRET);
    // JWT userId can arrive as a string — always normalise.
    return {
      userId: Number(payload.userId),
      username: String(payload.username || ''),
      role: payload.role === 'hr' ? 'hr' : 'agent',
    };
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
}

export async function requireHr(request: NextRequest): Promise<AuthUser> {
  const auth = await getAuth(request);
  if (auth.role !== 'hr') throw new HttpError(403, 'Trainer (HR) access required');
  return auth;
}

/**
 * Service-to-service auth for integration endpoints: an HR JWT, or
 * `Bearer <TRAINING_SERVICE_TOKEN | CRON_SECRET>`.
 */
export async function requireServiceOrHr(request: NextRequest): Promise<AuthUser | { service: true }> {
  const header = request.headers.get('authorization') || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const tokens = [process.env.TRAINING_SERVICE_TOKEN, process.env.CRON_SECRET].filter(Boolean);
  if (bearer && tokens.includes(bearer)) return { service: true };
  return requireHr(request);
}

/** A rep may act on themselves; a trainer may act on anyone (?user_id=). */
export function resolveTargetUser(auth: AuthUser, requested: string | number | null | undefined): number {
  if (requested === null || requested === undefined || requested === '') return auth.userId;
  const id = Number(requested);
  if (!Number.isFinite(id)) throw new HttpError(400, 'Invalid user_id');
  if (id !== auth.userId && auth.role !== 'hr') throw new HttpError(403, 'Not allowed');
  return id;
}

export function ok(data: unknown, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ status: 'success', data, ...extra });
}

export function fail(err: unknown) {
  if (err instanceof HttpError) {
    return NextResponse.json({ status: 'error', message: err.message }, { status: err.status });
  }
  const message = err instanceof Error ? err.message : String(err);
  // Tables missing = migration not applied yet; say so instead of a bare 500.
  if (/relation "(training_|ai_)\w+" does not exist/.test(message)) {
    return NextResponse.json(
      { status: 'error', message: 'Training module is not installed yet (run scripts/apply-training-migration.js).' },
      { status: 503 }
    );
  }
  console.error('[training]', err);
  return NextResponse.json({ status: 'error', message: 'Internal error' }, { status: 500 });
}

/** Wrap a route handler with uniform error handling. */
export function handler<C = unknown>(fn: (request: NextRequest, ctx: C) => Promise<Response>) {
  return async (request: NextRequest, ctx: C) => {
    try {
      return await fn(request, ctx);
    } catch (err) {
      return fail(err);
    }
  };
}

export async function readJson<T = any>(request: NextRequest): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new HttpError(400, 'Invalid JSON body');
  }
}
