/**
 * Short-lived, app-signed links for playing a 3CX recording through
 * /api/recordings/play. The browser never sees the 3CX admin token; the link only
 * unlocks one recording and expires.
 */
import { SignJWT, jwtVerify } from 'jose';

const SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-in-production'
);
const PURPOSE = 'recording-play';

export async function recordingPlayUrl(recId: number | string, ttl = '15m'): Promise<string> {
  const t = await new SignJWT({ recId: Number(recId), purpose: PURPOSE })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(SECRET);
  return `/api/recordings/play?t=${encodeURIComponent(t)}`;
}

export async function verifyRecordingPlayToken(t: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(t, SECRET);
    if (payload.purpose !== PURPOSE || typeof payload.recId !== 'number') return null;
    return payload.recId;
  } catch {
    return null;
  }
}
