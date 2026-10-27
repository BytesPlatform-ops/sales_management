'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Paperclip, Upload, Download, Trash2, FileText, Film, Music, File as FileIcon, X, RotateCcw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Btn, inputCls } from '@/components/training/ui';
import { Modal, useConfirm, useToast } from '@/components/projects/ui';
import { papi, usePapi, relTime } from '@/components/projects/lib';
import { MediaFile, fmtSize, mediaUrl, uploadFile } from './lib';

export const MAX_MB = 50;

interface Pending { key: string; file: File; description: string; progress: number; error?: string }

/**
 * Pick, drop or paste files → each gets a description → uploaded with a progress bar.
 * `requireDescription` matches the server rule (project and ticket files).
 */
export function Uploader({ target, requireDescription, onUploaded, compact, capturePaste }: {
  target: { entity_type: string; entity_id: number | string };
  requireDescription: boolean;
  onUploaded: () => void;
  compact?: boolean;
  /** Take screenshots pasted anywhere on the page (only one uploader per page should). */
  capturePaste?: boolean;
}) {
  const [queue, setQueue] = useState<Pending[]>([]);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const add = useCallback((files: FileList | File[]) => {
    const list = Array.from(files);
    const tooBig = list.filter((f) => f.size > MAX_MB * 1024 * 1024);
    if (tooBig.length) toast(`${tooBig.map((f) => f.name).join(', ')} ${tooBig.length === 1 ? 'is' : 'are'} over ${MAX_MB} MB`, 'error');
    const ok = list.filter((f) => f.size > 0 && f.size <= MAX_MB * 1024 * 1024);
    setQueue((q) => [...q, ...ok.map((file) => ({ key: `${file.name}-${file.size}-${Math.random()}`, file, description: '', progress: 0 }))]);
  }, [toast]);

  // Paste screenshots anywhere on the page while this uploader is mounted.
  useEffect(() => {
    if (!capturePaste) return;
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []);
      if (!files.length) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if ((tag === 'INPUT' || tag === 'TEXTAREA') && !files.some((f) => f.type.startsWith('image/'))) return;
      e.preventDefault();
      add(files.map((f, i) => (f.name === 'image.png' ? new File([f], `screenshot-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}${i ? `-${i}` : ''}.png`, { type: f.type }) : f)));
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [add, capturePaste]);

  async function start() {
    if (requireDescription && queue.some((q) => !q.description.trim())) {
      toast('Add a short description for each file', 'error');
      return;
    }
    setBusy(true);
    let failed = 0;
    for (const item of queue) {
      if (item.progress === 1) continue;
      try {
        await uploadFile(target, item.file, item.description.trim(), (p) => setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, progress: p, error: undefined } : x))));
      } catch (e) {
        failed++;
        setQueue((q) => q.map((x) => (x.key === item.key ? { ...x, error: (e as Error).message } : x)));
      }
    }
    setBusy(false);
    onUploaded();
    if (!failed) { setQueue([]); toast('Uploaded'); } else {
      setQueue((q) => q.filter((x) => x.progress !== 1));
      toast(`${failed} file${failed > 1 ? 's' : ''} failed — retry or remove`, 'error');
    }
  }

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); add(e.dataTransfer.files); }}
        className={cn('flex flex-wrap items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 text-center text-sm transition-colors',
          compact ? 'py-2' : 'py-4', drag ? 'border-primary-400 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-500')}>
        <Upload className="h-4 w-4" />
        <span>Drop files, paste a screenshot, or</span>
        <button type="button" className="font-medium text-primary-600 hover:underline" onClick={() => input.current?.click()}>browse</button>
        <span className="text-xs text-gray-400">· any type, up to {MAX_MB} MB</span>
        <input ref={input} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
      </div>
      {queue.length > 0 && (
        <ul className="mt-2 space-y-2">
          {queue.map((q) => (
            <li key={q.key} className="rounded-lg border border-gray-200 p-2">
              <div className="flex items-center gap-2 text-sm">
                <Paperclip className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="min-w-0 flex-1 truncate font-medium text-gray-800">{q.file.name}</span>
                <span className="text-xs text-gray-400">{fmtSize(q.file.size)}</span>
                {!busy && <button type="button" aria-label={`Remove ${q.file.name}`} onClick={() => setQueue((x) => x.filter((y) => y.key !== q.key))} className="rounded p-0.5 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>}
              </div>
              <input className={cn(inputCls, 'mt-1.5 py-1.5 text-sm')} placeholder={requireDescription ? 'What is this file? (required)' : 'Caption (optional)'}
                value={q.description} maxLength={1000} disabled={busy}
                onChange={(e) => setQueue((x) => x.map((y) => (y.key === q.key ? { ...y, description: e.target.value } : y)))} />
              {(busy || q.progress > 0) && (
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100" role="progressbar" aria-valuenow={Math.round(q.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-primary-500 transition-all" style={{ width: `${Math.round(q.progress * 100)}%` }} />
                </div>
              )}
              {q.error && <p className="mt-1 text-xs text-red-600">{q.error}</p>}
            </li>
          ))}
          <li className="flex justify-end gap-2">
            {!busy && <Btn size="sm" variant="ghost" onClick={() => setQueue([])}>Clear</Btn>}
            <Btn size="sm" onClick={start} disabled={busy}>{busy ? 'Uploading…' : `Upload ${queue.length} file${queue.length > 1 ? 's' : ''}`}</Btn>
          </li>
        </ul>
      )}
    </div>
  );
}

const KIND_ICON = { image: FileIcon, video: Film, audio: Music, pdf: FileText, file: FileIcon } as const;

/** Thumbnail / player / card for one file. Signed URLs are fetched on demand and expire. */
export function FileTile({ f, canDelete, onChanged, showTicket }: { f: MediaFile; canDelete: boolean; onChanged: () => void; showTicket?: boolean }) {
  const [src, setSrc] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const confirm = useConfirm();
  const toast = useToast();
  // Voice notes (from chat) play like any audio file here.
  const kind = (f.kind === 'voice' ? 'audio' : f.kind) as keyof typeof KIND_ICON;
  const previewable = kind === 'image' || kind === 'video' || kind === 'audio';

  useEffect(() => {
    let live = true;
    if (previewable) mediaUrl(f.id).then((r) => { if (live) setSrc(r.url); }).catch(() => {});
    return () => { live = false; };
  }, [f.id, previewable]);

  async function download() {
    try { window.open((await mediaUrl(f.id, true)).url, '_blank', 'noopener'); } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function view() {
    if (f.kind === 'image') return setOpen(true);
    try {
      const r = await mediaUrl(f.id);
      window.open(r.url, '_blank', 'noopener');
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function remove() {
    if (!(await confirm({ title: `Delete ${f.file_name}?`, body: 'HR can restore it for 30 days.', confirmLabel: 'Delete', danger: true }))) return;
    try { await papi(`/api/media/${f.id}`, { method: 'DELETE' }); onChanged(); } catch (e) { toast((e as Error).message, 'error'); }
  }

  const Icon = KIND_ICON[kind] || FileIcon;
  return (
    <div className="group relative flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white">
      <div className="flex h-32 items-center justify-center bg-gray-50">
        {f.kind === 'image' && src ? (
          <button type="button" onClick={() => setOpen(true)} className="h-full w-full"><img src={src} alt={f.description || f.file_name} className="h-full w-full object-cover" /></button>
        ) : f.kind === 'video' && src ? (
          <video src={src} controls preload="metadata" className="h-full w-full bg-black object-contain" />
        ) : kind === 'audio' && src ? (
          <audio src={src} controls preload="none" className="w-[90%]" />
        ) : (
          <button type="button" onClick={f.kind === 'pdf' ? view : download} className="flex flex-col items-center gap-1 text-gray-400 hover:text-gray-600">
            <Icon className="h-8 w-8" /><span className="text-[11px] uppercase">{f.file_name.split('.').pop()}</span>
          </button>
        )}
      </div>
      <div className="min-w-0 flex-1 p-2">
        <p className="truncate text-sm font-medium text-gray-800" title={f.file_name}>{f.file_name}</p>
        {f.description && <p className="line-clamp-2 text-xs text-gray-600">{f.description}</p>}
        <p className="mt-0.5 text-[11px] text-gray-400">
          {fmtSize(f.size_bytes)} · {f.uploaded_by_name || 'Someone'} · {relTime(f.created_at)}
          {showTicket && f.ticket_key ? ` · ${f.ticket_key}` : ''}
        </p>
      </div>
      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button type="button" onClick={download} aria-label={`Download ${f.file_name}`} className="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow hover:text-gray-900"><Download className="h-4 w-4" /></button>
        {canDelete && <button type="button" onClick={remove} aria-label={`Delete ${f.file_name}`} className="rounded-lg bg-white/90 p-1.5 text-gray-600 shadow hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title={f.file_name} size="lg"
        footer={<Btn variant="secondary" onClick={download}><Download className="h-4 w-4" />Download</Btn>}>
        {src && <img src={src} alt={f.description || f.file_name} className="mx-auto max-h-[70vh] w-auto rounded-lg" />}
        {f.description && <p className="mt-3 text-sm text-gray-600">{f.description}</p>}
      </Modal>
    </div>
  );
}

/** Files on one thing (ticket, comment, meeting) + the uploader. */
export function Attachments({ target, meId, isHr, requireDescription = true, canUpload = true, capturePaste, className }: {
  target: { entity_type: string; entity_id: number | string };
  meId: number | string | undefined;
  isHr: boolean;
  requireDescription?: boolean;
  canUpload?: boolean;
  capturePaste?: boolean;
  className?: string;
}) {
  const { data, mutate } = usePapi<MediaFile[]>(`/api/media?entity_type=${target.entity_type}&entity_id=${target.entity_id}`, { refreshInterval: 30_000 });
  const files = data || [];
  return (
    <div className={className}>
      {files.length > 0 && (
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {files.map((f) => <FileTile key={f.id} f={f} canDelete={isHr || String(f.uploaded_by) === String(meId)} onChanged={() => mutate()} />)}
        </div>
      )}
      {canUpload && <Uploader target={target} requireDescription={requireDescription} onUploaded={() => mutate()} compact={files.length > 0} capturePaste={capturePaste} />}
    </div>
  );
}

/** HR: recently deleted files with Restore. */
export function DeletedFiles({ projectId, onRestored }: { projectId: number; onRestored: () => void }) {
  const { data, mutate } = usePapi<MediaFile[]>(`/api/media?project_id=${projectId}&deleted=1`);
  const toast = useToast();
  if (!data?.length) return <p className="text-sm text-gray-500">Nothing deleted in the last 30 days.</p>;
  return (
    <ul className="divide-y divide-gray-100 rounded-xl border border-gray-200">
      {data.map((f) => (
        <li key={f.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
          <span className="min-w-0 truncate">{f.file_name} <span className="text-xs text-gray-400">· deleted {relTime(f.deleted_at!)}</span></span>
          <Btn size="sm" variant="secondary" onClick={async () => {
            try { await papi(`/api/media/${f.id}/restore`, { method: 'POST' }); mutate(); onRestored(); toast('Restored'); } catch (e) { toast((e as Error).message, 'error'); }
          }}><RotateCcw className="h-4 w-4" />Restore</Btn>
        </li>
      ))}
    </ul>
  );
}
