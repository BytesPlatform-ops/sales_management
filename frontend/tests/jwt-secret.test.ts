import { afterEach, describe, expect, it } from 'vitest';
import { assertJwtSecret, jwtSecret } from '@/lib/jwt-secret';

const saved = process.env.JWT_SECRET;
afterEach(() => { process.env.JWT_SECRET = saved; });

describe('jwtSecret', () => {
  it('refuses to work without JWT_SECRET', () => {
    delete process.env.JWT_SECRET;
    expect(() => jwtSecret()).toThrow(/JWT_SECRET is not set/);
    process.env.JWT_SECRET = '   ';
    expect(() => assertJwtSecret()).toThrow(/not set/);
  });

  it('refuses the old public default', () => {
    process.env.JWT_SECRET = 'your-super-secret-jwt-key-change-in-production';
    expect(() => jwtSecret()).toThrow(/old public default/);
  });

  it('returns the encoded secret and follows changes', () => {
    process.env.JWT_SECRET = 'first-secret';
    expect(new TextDecoder().decode(jwtSecret())).toBe('first-secret');
    process.env.JWT_SECRET = 'second-secret';
    expect(new TextDecoder().decode(jwtSecret())).toBe('second-secret');
  });
});
