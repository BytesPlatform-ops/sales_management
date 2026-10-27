'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, File as FileIcon, X, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fmtSize } from '@/components/tickets/lib';
import { ChatFile } from './types';
import { openDownload, signedUrl, useSignedUrl } from './signed';
import { VoiceNote } from './Voice';

/** Everything attached to one message, WhatsApp-style. */
export function MessageMedia({ files, mine, voiceMeta }: { files: ChatFile[]; mine: boolean; voiceMeta?: { duration?: number; peaks?: number[] } | null }) {
  const [viewer, setViewer] = useState<number | null>(null);
  const images = files.filter((f) => f.kind === 'image');
  const rest = files.filter((f) => f.kind !== 'image');
  return (
    <div className="space-y-1.5">
      {images.length > 0 && <ImageGrid images={images} onOpen={setViewer} />}
      {rest.map((f) =>
        f.kind === 'voice' ? <VoiceNote key={f.id} fileId={f.id} peaks={voiceMeta?.peaks} duration={voiceMeta?.duration} mine={mine} />
        : f.kind === 'video' ? <InlineVideo key={f.id} f={f} />
        : f.kind === 'audio' ? <InlineAudio key={f.id} f={f} />
        : <FileCard key={f.id} f={f} mine={mine} />
      )}
      {viewer !== null && <ImageViewer images={images} start={viewer} onClose={() => setViewer(null)} />}
    </div>
  );
}

function ImageGrid({ images, onOpen }: { images: ChatFile[]; onOpen: (i: number) => void }) {
  const shown = images.slice(0, 4);
  const extra = images.length - shown.length;
  return (
    <div className={cn('grid gap-1 overflow-hidden rounded-xl', shown.length === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
      {shown.map((f, i) => (
        <button key={f.id} type="button" onClick={() => onOpen(i)} aria-label={`Open ${f.file_name}`}
          className={cn('relative block overflow-hidden bg-black/5', shown.length === 1 ? 'max-h-72' : 'aspect-square', shown.length === 3 && i === 0 && 'col-span-2 aspect-[2/1]')}>
          <Thumb f={f} />
          {i === 3 && extra > 0 && <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-xl font-semibold text-white">+{extra}</span>}
        </button>
      ))}
    </div>
  );
}

function Thumb({ f }: { f: ChatFile }) {
  const src = useSignedUrl(f.id);
  if (!src) return <div className="flex h-32 w-full items-center justify-center"><Loader2 className="h-4 w-4 animate-spin text-gray-400" /></div>;
  return <img src={src} alt={f.description || f.file_name} className="h-full w-full object-cover" loading="lazy" />;
}

/** Full-screen viewer: arrows / swipe between images, download, Esc to close. */
export function ImageViewer({ images, start, onClose }: { images: ChatFile[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start);
  const [touchX, setTouchX] = useState<number | null>(null);
  const f = images[i];
  const src = useSignedUrl(f?.id ?? null);
  const go = (d: number) => setI((x) => (x + d + images.length) % images.length);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  return (
    <div role="dialog" aria-modal="true" aria-label={f.file_name} className="fixed inset-0 z-[70] flex flex-col bg-black/90"
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => { if (touchX !== null) { const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1); } setTouchX(null); }}>
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <span className="min-w-0 truncate text-sm">{f.file_name}{images.length > 1 ? ` · ${i + 1}/${images.length}` : ''}</span>
        <div className="flex gap-1">
          <button type="button" onClick={() => openDownload(f.id)} aria-label="Download" className="rounded-lg p-2 hover:bg-white/10"><Download className="h-5 w-5" /></button>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 hover:bg-white/10"><X className="h-5 w-5" /></button>
        </div>
      </div>
      <div className="relative flex flex-1 items-center justify-center px-12 pb-6" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {images.length > 1 && <button type="button" onClick={() => go(-1)} aria-label="Previous" className="absolute left-2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronLeft className="h-6 w-6" /></button>}
        {src ? <img src={src} alt={f.description || f.file_name} className="max-h-full max-w-full rounded object-contain" /> : <Loader2 className="h-6 w-6 animate-spin text-white" />}
        {images.length > 1 && <button type="button" onClick={() => go(1)} aria-label="Next" className="absolute right-2 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"><ChevronRight className="h-6 w-6" /></button>}
      </div>
      {f.description && <p className="px-4 pb-4 text-center text-sm text-white/80">{f.description}</p>}
    </div>
  );
}

function InlineVideo({ f }: { f: ChatFile }) {
  const src = useSignedUrl(f.id);
  return src ? <video src={src} controls preload="metadata" className="max-h-72 w-full rounded-xl bg-black" /> : <div className="h-40 rounded-xl bg-black/10" />;
}

function InlineAudio({ f }: { f: ChatFile }) {
  const src = useSignedUrl(f.id);
  return (
    <div className="rounded-xl bg-white/80 p-2 text-gray-800">
      <p className="mb-1 truncate text-xs font-medium">{f.file_name}</p>
      {src && <audio src={src} controls preload="none" className="w-full" />}
    </div>
  );
}

function FileCard({ f, mine }: { f: ChatFile; mine: boolean }) {
  const isPdf = f.kind === 'pdf';
  const Icon = isPdf ? FileText : FileIcon;
  return (
    <div className={cn('flex items-center gap-3 rounded-xl p-2.5', mine ? 'bg-white/15' : 'bg-white')}>
      <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', isPdf ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500')}><Icon className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{f.file_name}</p>
        <p className={cn('text-[11px]', mine ? 'text-white/70' : 'text-gray-500')}>{fmtSize(f.size_bytes)}{f.file_name.includes('.') ? ` · ${f.file_name.split('.').pop()!.toUpperCase()}` : ''}</p>
      </div>
      {isPdf && (
        <button type="button" onClick={async () => window.open(await signedUrl(f.id), '_blank', 'noopener')} aria-label={`Open ${f.file_name}`}
          className={cn('rounded-lg p-1.5', mine ? 'hover:bg-white/20' : 'hover:bg-gray-100')}><ExternalLink className="h-4 w-4" /></button>
      )}
      <button type="button" onClick={() => openDownload(f.id)} aria-label={`Download ${f.file_name}`}
        className={cn('rounded-lg p-1.5', mine ? 'hover:bg-white/20' : 'hover:bg-gray-100')}><Download className="h-4 w-4" /></button>
    </div>
  );
}
