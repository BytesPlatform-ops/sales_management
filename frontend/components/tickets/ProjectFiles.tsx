'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { LayoutGrid, List as ListIcon, Download, Search, ChevronDown, ChevronRight, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Spinner, ErrorNote, Empty, inputCls } from '@/components/training/ui';
import { SectionCard, selectCls, useToast } from '@/components/projects/ui';
import { usePapi, relTime, fmtDay } from '@/components/projects/lib';
import { Uploader, FileTile, DeletedFiles } from './Attachments';
import { MediaFile, fmtSize, mediaUrl } from './lib';

const KINDS: { value: string; label: string }[] = [
  { value: '', label: 'All types' }, { value: 'image', label: 'Images' }, { value: 'video', label: 'Videos' },
  { value: 'audio', label: 'Audio' }, { value: 'pdf', label: 'PDF' }, { value: 'file', label: 'Other' },
];

/** The project "Files" tab: upload project files, browse every file in the project. */
export function ProjectFiles({ projectId, meId, isHr }: { projectId: number; meId?: number | string; isHr: boolean }) {
  const toast = useToast();
  const [kind, setKind] = useState('');
  const [uploader, setUploader] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'gallery' | 'list'>('gallery');
  const [showDeleted, setShowDeleted] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const params = new URLSearchParams({ project_id: String(projectId) });
  if (kind) params.set('kind', kind);
  if (uploader) params.set('uploader', uploader);
  if (q) params.set('q', q);
  const { data, error, isLoading, mutate } = usePapi<MediaFile[]>(`/api/media?${params}`, { refreshInterval: 30_000, keepPreviousData: true });
  // Uploader choices come from the unfiltered-by-uploader result, so the list doesn't shrink to one person.
  const { data: all } = usePapi<MediaFile[]>(`/api/media?project_id=${projectId}`, { refreshInterval: 30_000 });
  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of all || []) m.set(String(f.uploaded_by), f.uploaded_by_name || 'Someone');
    return Array.from(m, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);

  const files = data || [];
  const refresh = () => { mutate(); };

  async function download(f: MediaFile) {
    try { window.open((await mediaUrl(f.id, true)).url, '_blank', 'noopener'); } catch (e) { toast((e as Error).message, 'error'); }
  }

  return (
    <div className="space-y-4">
      <SectionCard title="Add project files">
        <Uploader target={{ entity_type: 'project', entity_id: projectId }} requireDescription capturePaste onUploaded={refresh} />
      </SectionCard>

      <SectionCard title="All files"
        action={
          <div className="inline-flex gap-1 rounded-lg bg-gray-100 p-0.5" role="group" aria-label="View">
            {(['gallery', 'list'] as const).map((m) => (
              <button key={m} type="button" onClick={() => setMode(m)} aria-pressed={mode === m} aria-label={m === 'gallery' ? 'Gallery view' : 'List view'}
                className={cn('rounded-md p-1.5', mode === m ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>
                {m === 'gallery' ? <LayoutGrid className="h-4 w-4" /> : <ListIcon className="h-4 w-4" />}
              </button>
            ))}
          </div>
        }>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_160px_180px]">
          <label className="relative">
            <span className="sr-only">Search files</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input className={cn(inputCls, 'pl-9')} placeholder="Search names and descriptions" value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <select aria-label="File type" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value)}>
            {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          <select aria-label="Uploaded by" className={selectCls} value={uploader} onChange={(e) => setUploader(e.target.value)}>
            <option value="">Anyone</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        {error && <ErrorNote error={error} />}
        {isLoading && !data && <Spinner label="Loading files…" />}
        {data && !files.length && (
          <Empty icon={<FolderOpen className="h-6 w-6" />} title={q || kind || uploader ? 'No files match' : 'No files yet'}
            body={q || kind || uploader ? 'Try a different search or filter.' : 'Files added to the project, its tickets and comments all show up here.'} />
        )}

        {files.length > 0 && mode === 'gallery' && (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {files.map((f) => <FileTile key={f.id} f={f} showTicket canDelete={isHr || String(f.uploaded_by) === String(meId)} onChanged={refresh} />)}
          </div>
        )}

        {files.length > 0 && mode === 'list' && (
          <div className="overflow-x-auto rounded-xl border border-gray-200">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs font-semibold uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">Description</th>
                  <th className="px-3 py-2">Ticket</th>
                  <th className="px-3 py-2">Uploaded by</th>
                  <th className="px-3 py-2 text-right">Size</th>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2"><span className="sr-only">Download</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {files.map((f) => (
                  <tr key={f.id} className="hover:bg-gray-50">
                    <td className="max-w-[220px] truncate px-3 py-2 font-medium text-gray-800" title={f.file_name}>{f.file_name}</td>
                    <td className="max-w-[280px] truncate px-3 py-2 text-gray-600" title={f.description || ''}>{f.description || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2">
                      {f.ticket_key ? <Link href={`/projects/${projectId}/tickets/${f.ticket_key}`} className="font-mono text-xs text-primary-600 hover:underline">{f.ticket_key}</Link> : <span className="text-gray-400">—</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-600">{f.uploaded_by_name || '—'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right text-gray-500">{fmtSize(f.size_bytes)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-gray-500" title={relTime(f.created_at)}>{fmtDay(f.created_at.slice(0, 10))}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={() => download(f)} aria-label={`Download ${f.file_name}`} className="rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-900">
                        <Download className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {isHr && (
          <div className="mt-5 border-t border-gray-100 pt-3">
            <button type="button" onClick={() => setShowDeleted((x) => !x)} aria-expanded={showDeleted}
              className="inline-flex items-center gap-1 text-sm font-medium text-gray-600 hover:text-gray-900">
              {showDeleted ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}Recently deleted
            </button>
            {showDeleted && <div className="mt-2"><DeletedFiles projectId={projectId} onRestored={refresh} /></div>}
          </div>
        )}
      </SectionCard>
    </div>
  );
}
