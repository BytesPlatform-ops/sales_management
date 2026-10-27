/**
 * The JWT signing key. There is deliberately no fallback: a missing JWT_SECRET
 * would let anyone forge a login token with a well-known default, so the app
 * refuses to start (instrumentation.ts) and every auth check fails closed.
 *
 * Read at call time rather than import time so `next build` doesn't need it.
 */
let cached: { raw: string; key: Uint8Array } | null = null;

const OLD_DEFAULT = 'your-super-secret-jwt-key-change-in-production';

export function assertJwtSecret(): string {
  const raw = process.env.JWT_SECRET;
  if (!raw || !raw.trim()) throw new Error('JWT_SECRET is not set');
  if (raw === OLD_DEFAULT) throw new Error('JWT_SECRET is still the old public default; set a real secret');
  return raw;
}

export function jwtSecret(): Uint8Array {
  const raw = assertJwtSecret();
  if (cached?.raw !== raw) cached = { raw, key: new TextEncoder().encode(raw) };
  return cached.key;
}
