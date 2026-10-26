/**
 * Shared HR authorization for API routes.
 * Verifies the JWT (same scheme as app/api/auth/login) and enforces role === 'hr'.
 * Every payroll-report route calls this server-side; client-provided values are
 * never trusted for authorization.
 */
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);

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
  const authHeader = request.headers.get('authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new HttpError(401, 'No token provided');
  }
  const token = authHeader.split(' ')[1];
  let payload: HrPayload;
  try {
    const verified = await jwtVerify(token, JWT_SECRET);
    payload = verified.payload as unknown as HrPayload;
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  if (payload.role !== 'hr') {
    throw new HttpError(403, 'HR access required');
  }
  return payload;
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
