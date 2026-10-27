import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, hotp, otpauthUri, totpAt, verifyTotp } from '@/lib/auth/totp';
import { adminFreeWrite, deviceHash, effectiveRole, isWriteMethod } from '@/lib/auth/session';

// RFC 6238 appendix B (SHA-1 seed "12345678901234567890"), last 6 digits.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP', () => {
  it('matches the RFC 6238 test vectors', () => {
    expect(totpAt(RFC_SECRET, 59_000)).toBe('287082');
    expect(totpAt(RFC_SECRET, 1111111109_000)).toBe('081804');
    expect(totpAt(RFC_SECRET, 1234567890_000)).toBe('005924');
    expect(totpAt(RFC_SECRET, 2000000000_000)).toBe('279037');
  });
  it('matches RFC 4226 HOTP values', () => {
    const k = Buffer.from('12345678901234567890');
    expect([0, 1, 2, 9].map((c) => hotp(k, c))).toEqual(['755224', '287082', '359152', '520489']);
  });
  it('base32 round-trips', () => {
    const b = Buffer.from([0, 1, 2, 250, 255, 16, 99]);
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });
  it('accepts ±1 step for clock drift and returns the step; rejects others', () => {
    const t = 1_800_000_000_000;
    const code = totpAt(RFC_SECRET, t);
    expect(verifyTotp(RFC_SECRET, code, t)).toBe(Math.floor(t / 30000));
    expect(verifyTotp(RFC_SECRET, code, t + 30_000)).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, code, t + 90_000)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', t)).toBeNull();
    expect(verifyTotp(RFC_SECRET, '12345', t)).toBeNull();
  });
  it('builds an authenticator URI', () => {
    expect(otpauthUri('ABC', 'boss')).toBe('otpauth://totp/Bytes%20Platform:boss?secret=ABC&issuer=Bytes%20Platform&algorithm=SHA1&digits=6&period=30');
  });
});

describe('session rules', () => {
  it('a CEO acts with HR permissions; others keep theirs', () => {
    expect(effectiveRole('ceo')).toBe('hr');
    expect(effectiveRole('developer')).toBe('developer');
    expect(effectiveRole('agent')).toBe('agent');
  });
  it('treats everything but GET/HEAD/OPTIONS as a write', () => {
    expect(['GET', 'head', 'OPTIONS'].map(isWriteMethod)).toEqual([false, false, false]);
    expect(['POST', 'PUT', 'PATCH', 'DELETE'].map(isWriteMethod)).toEqual([true, true, true, true]);
  });
  it('only a few personal/security CEO writes skip Admin mode', () => {
    expect(adminFreeWrite('POST', '/api/auth/admin-mode')).toBe(true);
    expect(adminFreeWrite('POST', '/api/ceo/view-as')).toBe(true);
    expect(adminFreeWrite('POST', '/api/ceo/vault-revocations')).toBe(true);
    expect(adminFreeWrite('DELETE', '/api/ceo/vault-revocations')).toBe(false);
    expect(adminFreeWrite('POST', '/api/projects/3/env/7/value')).toBe(true);
    expect(adminFreeWrite('POST', '/api/projects/3/env')).toBe(false);
    expect(adminFreeWrite('POST', '/api/ceo/users')).toBe(false);
    expect(adminFreeWrite('PUT', '/api/hr/settings')).toBe(false);
  });
  it('device hash ignores browser minor versions and the last IP octet', () => {
    const a = deviceHash('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.1', '10.1.2.3');
    const b = deviceHash('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/121.5.0', '10.1.2.99');
    const c = deviceHash('Mozilla/5.0 (Windows NT 10.0) Firefox/120.0', '10.1.2.3');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});
