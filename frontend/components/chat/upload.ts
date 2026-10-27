'use client';

/**
 * Upload one file to a message draft, step by step so a failed upload can be
 * cleaned up (otherwise its unfinished record would block sending).
 */
async function call<T>(path: string, method: string, body?: unknown): Promise<T> {
  const t = localStorage.getItem('token');
  const res = await fetch(path, {
    method, cache: 'no-store',
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(t ? { Authorization: `Bearer ${t}` } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const j = await res.json().catch(() => null);
  if (!res.ok || j?.status === 'error') throw Object.assign(new Error(j?.message || `Request failed (${res.status})`), { status: res.status });
  return j.data as T;
}

export async function uploadToTarget(
  target: { entity_type: string; entity_id: number },
  file: Blob & { name?: string },
  opts: { name?: string; kind?: 'voice'; description?: string; onProgress?: (p: number) => void } = {},
): Promise<string> {
  const name = opts.name || (file as File).name || 'file';
  const { id, upload } = await call<{ id: string; upload: { url: string; method: 'PUT'; form: boolean; headers: Record<string, string> } }>(
    '/api/media/upload-url', 'POST',
    { ...target, file_name: name, mime_type: file.type || 'application/octet-stream', size_bytes: file.size, description: opts.description || '', kind: opts.kind },
  );
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(upload.method, upload.url);
      for (const [k, v] of Object.entries(upload.headers)) xhr.setRequestHeader(k, v);
      xhr.upload.onprogress = (e) => { if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total); };
      xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
      xhr.onerror = () => reject(new Error('Upload failed — check your connection'));
      if (upload.form) {
        const fd = new FormData();
        fd.append('cacheControl', '3600');
        fd.append('', file, name);
        xhr.send(fd);
      } else {
        if (file.type) xhr.setRequestHeader('Content-Type', file.type);
        xhr.send(file);
      }
    });
    await call(`/api/media/${id}/complete`, 'POST', {});
  } catch (err) {
    await call(`/api/media/${id}`, 'DELETE').catch(() => {});
    throw err;
  }
  opts.onProgress?.(1);
  return id;
}

export { call as chatCall };
