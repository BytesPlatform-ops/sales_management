/**
 * Where uploaded files live.
 *
 *   supabase  private bucket (MEDIA_BUCKET, default "project-media"), server uses
 *             SUPABASE_SERVICE_ROLE_KEY to mint short-lived signed URLs; the browser
 *             uploads and downloads directly, so files never pass through Render.
 *   local     development only: files under frontend/.media-local, served by
 *             /api/media/local with short-lived signed tokens.
 *
 * MEDIA_STORAGE picks one; by default Supabase when the service key is set,
 * otherwise local outside production.
 */
import { promises as fs } from 'fs';
import path from 'path';
import { SignJWT, jwtVerify } from 'jose';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { HttpError } from '@/lib/training/http';
import { jwtSecret } from '@/lib/jwt-secret';

export interface UploadTarget {
  url: string;
  method: 'PUT';
  /** Supabase signed uploads expect multipart form data with the file under an empty field name. */
  form: boolean;
  headers: Record<string, string>;
}

export interface MediaStorage {
  name: 'supabase' | 'local';
  signedUpload(objectPath: string, mime: string, maxBytes: number): Promise<UploadTarget>;
  /** Size in bytes, or null if the object isn't there. */
  size(objectPath: string): Promise<number | null>;
  signedUrl(objectPath: string, opts: { fileName: string; mime: string; download: boolean; ttlSeconds: number }): Promise<string>;
  remove(objectPath: string): Promise<void>;
  /** Server-side copy (forwarding a message's files to another project, etc.). */
  copy(fromPath: string, toPath: string): Promise<void>;
}

export const bucket = () => process.env.MEDIA_BUCKET || 'project-media';

// ------------------------------------------------------------------ supabase

let sb: SupabaseClient | null = null;
function supabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new HttpError(503, 'File uploads are not configured on the server (SUPABASE_SERVICE_ROLE_KEY)');
  if (!sb) sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return sb;
}

const supabaseStorage: MediaStorage = {
  name: 'supabase',
  async signedUpload(objectPath) {
    const { data, error } = await supabaseAdmin().storage.from(bucket()).createSignedUploadUrl(objectPath);
    if (error || !data) throw new Error(`Could not create upload URL: ${error?.message}`);
    return { url: data.signedUrl, method: 'PUT', form: true, headers: { 'x-upsert': 'false' } };
  },
  async size(objectPath) {
    const { data, error } = await supabaseAdmin().storage.from(bucket()).createSignedUrl(objectPath, 60);
    if (error || !data) return null;
    const res = await fetch(data.signedUrl, { method: 'HEAD' });
    if (!res.ok) return null;
    return Number(res.headers.get('content-length') || 0);
  },
  async signedUrl(objectPath, { fileName, download, ttlSeconds }) {
    const { data, error } = await supabaseAdmin().storage.from(bucket())
      .createSignedUrl(objectPath, ttlSeconds, { download: download ? fileName : false });
    if (error || !data) throw new Error(`Could not sign download: ${error?.message}`);
    return data.signedUrl;
  },
  async remove(objectPath) {
    await supabaseAdmin().storage.from(bucket()).remove([objectPath]);
  },
  async copy(fromPath, toPath) {
    const { error } = await supabaseAdmin().storage.from(bucket()).copy(fromPath, toPath);
    if (error) throw new Error(`Could not copy file: ${error.message}`);
  },
};

// ------------------------------------------------------------------ local (development)

export const LOCAL_ROOT = path.join(process.cwd(), '.media-local');

export function localFile(objectPath: string): string {
  const full = path.resolve(LOCAL_ROOT, objectPath);
  if (!full.startsWith(LOCAL_ROOT + path.sep)) throw new HttpError(400, 'Bad path');
  return full;
}

type LocalClaims = { purpose: 'media-up' | 'media-down'; p: string; max?: number; mime?: string; name?: string; dl?: boolean };

async function localToken(claims: LocalClaims, ttlSeconds: number) {
  return new SignJWT(claims as any).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime(`${ttlSeconds}s`).sign(jwtSecret());
}

export async function readLocalToken(token: string, purpose: LocalClaims['purpose']): Promise<LocalClaims> {
  try {
    const { payload } = await jwtVerify(token, jwtSecret());
    if (payload.purpose !== purpose || typeof payload.p !== 'string') throw new Error('wrong purpose');
    return payload as unknown as LocalClaims;
  } catch {
    throw new HttpError(403, 'Link expired or invalid');
  }
}

const localStorage_: MediaStorage = {
  name: 'local',
  async signedUpload(objectPath, mime, maxBytes) {
    const t = await localToken({ purpose: 'media-up', p: objectPath, max: maxBytes, mime }, 3600);
    return { url: `/api/media/local?t=${encodeURIComponent(t)}`, method: 'PUT', form: false, headers: {} };
  },
  async size(objectPath) {
    try { return (await fs.stat(localFile(objectPath))).size; } catch { return null; }
  },
  async signedUrl(objectPath, { fileName, mime, download, ttlSeconds }) {
    const t = await localToken({ purpose: 'media-down', p: objectPath, name: fileName, mime, dl: download }, ttlSeconds);
    return `/api/media/local?t=${encodeURIComponent(t)}`;
  },
  async remove(objectPath) {
    await fs.rm(localFile(objectPath), { force: true });
  },
  async copy(fromPath, toPath) {
    const to = localFile(toPath);
    await fs.mkdir(path.dirname(to), { recursive: true });
    await fs.copyFile(localFile(fromPath), to);
  },
};

export function mediaStorage(): MediaStorage {
  const pick = process.env.MEDIA_STORAGE
    || (process.env.SUPABASE_SERVICE_ROLE_KEY ? 'supabase' : process.env.NODE_ENV === 'production' ? 'supabase' : 'local');
  return pick === 'local' ? localStorage_ : supabaseStorage;
}
