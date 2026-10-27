/**
 * Shared HR authorization for API routes.
 * Verifies the JWT (same scheme as app/api/auth/login) and enforces role === 'hr'.
 * Every payroll-report route calls this server-side; client-provided values are
 * never trusted for authorization.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthError, verifyRequest } from '@/lib/auth/session';

export interface HrPayload {
  userId: number;
  username: string;
  role: string;
}

export class HttpError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
  }
}

/** Returns the verified HR payload or throws HttpError(401/403). */
export async function requireHR(request: NextRequest): Promise<HrPayload> {
  let a;
  try {
    a = await verifyRequest(request);
  } catch (e) {
    if (e instanceof AuthError) throw new HttpError(e.status, e.message);
    throw e;
  }
  // A CEO passes as HR (writes only get here with Admin mode on).
  if (a.effectiveRole !== 'hr') {
    throw new HttpError(403, 'HR access required');
  }
  return { userId: a.userId, username: a.username, role: 'hr' };
}

export function errorResponse(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json({ status: 'error', message: err.message }, { status: err.statusCode });
  }
  const message = err instanceof Error ? err.message : 'Unexpected error';
  const isValidation = /invalid|expected|not found|missing/i.test(message);
  return NextResponse.json(
    { status: 'error', message },
    { status: isValidation ? 400 : 500 }
  );
}

/** Lightweight structured audit log (no schema change). */
export function auditLog(
  action: string,
  actor: HrPayload,
  detail: Record<string, unknown>
): void {
  console.log(
    `[AUDIT] ${action} by=${actor.username}(#${actor.userId}) ` +
      Object.entries(detail)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')
  );
}
