/**
 * Short-lived, app-signed links for playing a 3CX recording through
 * /api/recordings/play. The browser never sees the 3CX admin token; the link only
 * unlocks one recording and expires.
 */
import { SignJWT, jwtVerify } from 'jose';
import { jwtSecret } from '@/lib/jwt-secret';

const PURPOSE = 'recording-play';

// HR keeps audit pages open for a whole review session, so links last a shift;
// each link still unlocks only one recording.
export async function recordingPlayUrl(recId: number | string, ttl = '12h'): Promise<string> {
  const t = await new SignJWT({ recId: Number(recId), purpose: PURPOSE })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ttl)
    .sign(jwtSecret());
  return `/api/recordings/play?t=${encodeURIComponent(t)}`;
}

export async function verifyRecordingPlayToken(t: string): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(t, jwtSecret());
    if (payload.purpose !== PURPOSE || typeof payload.recId !== 'number') return null;
    return payload.recId;
  } catch {
    return null;
  }
}
