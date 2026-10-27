import { randomBytes } from 'crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { masterKey, newDataKey, open, seal, secretAad, unwrapDataKey, wrapDataKey } from '@/lib/vault/crypto';

const saved = process.env.VAULT_MASTER_KEY;
beforeEach(() => { process.env.VAULT_MASTER_KEY = randomBytes(32).toString('base64'); });
afterEach(() => { process.env.VAULT_MASTER_KEY = saved; });

describe('vault crypto', () => {
  it('round-trips a value', () => {
    const k = newDataKey();
    const s = seal(k, 'sk_live_123', secretAad(1, 'development', 'STRIPE'));
    expect(s.ciphertext.toString('utf8')).not.toContain('sk_live_123');
    expect(open(k, s, secretAad(1, 'development', 'STRIPE')).toString('utf8')).toBe('sk_live_123');
  });

  it('uses a fresh IV every time', () => {
    const k = newDataKey();
    const a = seal(k, 'same', 'aad');
    const b = seal(k, 'same', 'aad');
    expect(a.iv.equals(b.iv)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
  });

  it('rejects a tampered ciphertext or tag', () => {
    const k = newDataKey();
    const s = seal(k, 'value', 'aad');
    const bad = Buffer.from(s.ciphertext); bad[0] ^= 1;
    expect(() => open(k, { ...s, ciphertext: bad }, 'aad')).toThrow(/Could not decrypt/);
    const badTag = Buffer.from(s.tag); badTag[0] ^= 1;
    expect(() => open(k, { ...s, tag: badTag }, 'aad')).toThrow(/Could not decrypt/);
  });

  it('will not open a value moved to another project, environment or key', () => {
    const k = newDataKey();
    const s = seal(k, 'value', secretAad(1, 'staging', 'A'));
    expect(() => open(k, s, secretAad(2, 'staging', 'A'))).toThrow();
    expect(() => open(k, s, secretAad(1, 'production', 'A'))).toThrow();
    expect(() => open(k, s, secretAad(1, 'staging', 'B'))).toThrow();
  });

  it('error messages never contain the plaintext', () => {
    const k = newDataKey();
    const s = seal(k, 'TOP-SECRET-VALUE', 'aad');
    try { open(newDataKey(), s, 'aad'); } catch (e) { expect(String((e as Error).message)).not.toContain('TOP-SECRET'); }
  });

  it('wraps a data key per project with the master key', () => {
    const dk = newDataKey();
    const w = wrapDataKey(dk, 7);
    expect(unwrapDataKey(w, 7).equals(dk)).toBe(true);
    expect(() => unwrapDataKey(w, 8)).toThrow();
    process.env.VAULT_MASTER_KEY = randomBytes(32).toString('base64');
    expect(() => unwrapDataKey(w, 7)).toThrow();
  });

  it('requires a 32-byte base64 master key', () => {
    delete process.env.VAULT_MASTER_KEY;
    expect(() => masterKey()).toThrow(/not set/);
    process.env.VAULT_MASTER_KEY = randomBytes(16).toString('base64');
    expect(() => masterKey()).toThrow(/32 bytes/);
  });
});
