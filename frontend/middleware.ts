/**
 * Defense in depth for CEO "view as": a read-only token may never write.
 * The real check is in lib/auth/session (verifyRequest, which also verifies the
 * signature). Here the token is only decoded, never trusted: this can refuse a
 * request, it can't allow one.
 */
import { NextRequest, NextResponse } from 'next/server';
import { decodeJwt } from 'jose';

export function middleware(request: NextRequest) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return NextResponse.next();
  const h = request.headers.get('authorization');
  if (!h?.startsWith('Bearer ')) return NextResponse.next();
  try {
    if (decodeJwt(h.slice(7)).readonly === true) {
      return NextResponse.json({ status: 'error', message: 'Read-only view: changes are disabled' }, { status: 403 });
    }
  } catch {
    // Not a JWT (e.g. a cron secret): leave it to the route.
  }
  return NextResponse.next();
}

export const config = { matcher: '/api/:path*' };
