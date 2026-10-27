/**
 * Envelope encryption for Project Env (AES-256-GCM, Node crypto).
 *
 *   VAULT_MASTER_KEY (32 bytes, base64, Render env only)
 *     └─ wraps one random data key per project   (vault_project_keys)
 *          └─ encrypts each value with a fresh IV  (vault_secrets)
 *
 * Every seal binds "additional authenticated data" naming what it belongs to,
 * so a ciphertext copied onto another project, environment or key fails to
 * open instead of silently decrypting there.
 *
 * Error messages never include plaintext or key material.
 */
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export interface Sealed { ciphertext: Buffer; iv: Buffer; tag: Buffer }

export class VaultConfigError extends Error {}

export function masterKey(): Buffer {
  const raw = process.env.VAULT_MASTER_KEY;
  if (!raw) throw new VaultConfigError('VAULT_MASTER_KEY is not set');
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) throw new VaultConfigError('VAULT_MASTER_KEY must be 32 bytes, base64-encoded');
  return key;
}

export function seal(key: Buffer, plaintext: Buffer | string, aad: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function open(key: Buffer, s: Sealed, aad: string): Buffer {
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, s.iv);
    decipher.setAAD(Buffer.from(aad, 'utf8'));
    decipher.setAuthTag(s.tag);
    return Buffer.concat([decipher.update(s.ciphertext), decipher.final()]);
  } catch {
    throw new Error('Could not decrypt vault data (wrong key or tampered record)');
  }
}

export const newDataKey = () => randomBytes(32);

export const dataKeyAad = (projectId: number) => `vault:project-key:${projectId}`;
export const secretAad = (projectId: number, environment: string, keyName: string) =>
  `vault:secret:${projectId}:${environment}:${keyName}`;

export function wrapDataKey(dataKey: Buffer, projectId: number, master = masterKey()): Sealed {
  return seal(master, dataKey, dataKeyAad(projectId));
}

export function unwrapDataKey(s: Sealed, projectId: number, master = masterKey()): Buffer {
  return open(master, s, dataKeyAad(projectId));
}
