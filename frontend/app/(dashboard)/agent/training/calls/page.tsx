'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FileAudio, Headphones, Upload, ListChecks } from 'lucide-react';
import { tapi, useTraining, fmtDate } from '@/lib/training/client';
import { PageHeader, Panel, ErrorNote, Spinner, Pill, Btn, Empty, scoreTone } from '@/components/training/ui';
import { REVIEW_STATUS, fmtDuration } from '@/components/training/rep/common';
import { cn } from '@/lib/utils';

function audioDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    try {
      const url = URL.createObjectURL(file);
      const a = new Audio();
      a.preload = 'metadata';
      a.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(Number.isFinite(a.duration) ? Math.round(a.duration) : null); };
      a.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      a.src = url;
      setTimeout(() => resolve(null), 4000);
    } catch {
      resolve(null);
    }
  });
}

export default function MyCallsPage() {
  const router = useRouter();
  const list = useTraining<any[]>('/call-reviews');
  const cands = useTraining<any[]>('/call-reviews/candidates');
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const gradeCandidate = async (id: number) => {
    setBusy(`c${id}`);
    setErr(null);
    try {
      const r = await tapi<any>('/call-reviews', { method: 'POST', body: { call_transcript_id: id } });
      router.push(`/agent/training/calls/${r.id}`);
    } catch (e) {
      setErr(e);
      setBusy(null);
    }
  };

  const upload = async () => {
    if (!file) return;
    setBusy('upload');
    setErr(null);
    try {
      const form = new FormData();
      form.append('audio', file);
      const d = await audioDuration(file);
      if (d) form.append('duration_s', String(d));
      const r = await tapi<any>('/call-reviews', { form });
      router.push(`/agent/training/calls/${r.id}`);
    } catch (e) {
      setErr(e);
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader title="My calls" subtitle="Grade your real calls with the same 100-point scorecard used in roleplays. Low or very high scores also go to your trainer." />
      <ErrorNote error={err} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Panel title="Graded calls">
            {list.error ? <ErrorNote error={list.error} /> : !list.data ? <Spinner /> : list.data.length === 0 ? (
              <Empty icon={<Headphones className="h-6 w-6" />} title="No graded calls yet" body="Pick a recent call on the right, or upload a recording." />
            ) : (
              <div className="overflow-x-auto -mx-5">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-gray-400">
                      <th className="px-5 py-2 font-medium">Call</th><th className="px-3 py-2 font-medium">Length</th>
                      <th className="px-3 py-2 font-medium">Status</th><th className="px-5 py-2 font-medium text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {list.data.map((r) => {
                      const st = REVIEW_STATUS[r.status] || { label: r.status, tone: 'gray' as const };
                      return (
                        <tr key={r.id} className="hover:bg-gray-50">
                          <td className="px-5 py-2.5">
                            <Link href={`/agent/training/calls/${r.id}`} className="font-medium text-gray-900 hover:text-primary-700">{fmtDate(r.created_at, true)}</Link>
                            <div className="text-xs text-gray-500">{r.source === 'upload' ? 'Uploaded recording' : 'From the QA system'}</div>
                          </td>
                          <td className="px-3 py-2.5 tabular-nums text-gray-600">{fmtDuration(r.duration_s)}</td>
                          <td className="px-3 py-2.5"><Pill tone={st.tone}>{st.label}</Pill></td>
                          <td className={cn('px-5 py-2.5 text-right font-semibold tabular-nums', scoreTone(r.final_score === null ? null : Number(r.final_score)))}>{r.final_score === null ? '—' : Math.round(Number(r.final_score))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>
        </div>

        <div className="space-y-4">
          <Panel title={<span className="inline-flex items-center gap-1.5"><ListChecks className="h-4 w-4" aria-hidden /> Grade a recent call</span>}>
            <p className="text-sm text-gray-600 mb-3">These real calls (over 1 minute) were already transcribed by the QA system.</p>
            {cands.error ? <ErrorNote error={cands.error} /> : !cands.data ? <Spinner /> : cands.data.length === 0 ? (
              <p className="text-sm text-gray-500">No new transcribed calls right now.</p>
            ) : (
              <ul className="space-y-2">
                {cands.data.map((c) => (
                  <li key={c.id} className="rounded-xl border border-gray-200 p-3">
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-medium text-gray-900">{fmtDate(c.call_started_at || c.shift_date, true)}</span>
                      <span className="text-xs text-gray-500 tabular-nums">{fmtDuration(c.duration_sec)}</span>
                    </div>
                    {c.preview && <p className="mt-1 text-xs text-gray-500 line-clamp-2">{c.preview}</p>}
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <span className="text-xs text-gray-500">{c.meeting_scheduled ? 'Meeting booked · ' : ''}{c.disposition || ''}</span>
                      <Btn size="sm" onClick={() => gradeCandidate(c.id)} disabled={!!busy}>{busy === `c${c.id}` ? 'Grading…' : 'Grade it'}</Btn>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={<span className="inline-flex items-center gap-1.5"><Upload className="h-4 w-4" aria-hidden /> Upload a recording</span>}>
            <p className="text-sm text-gray-600 mb-3">MP3, WAV, M4A or WebM, under 25 MB. Only connected conversations (not voicemails) can be graded.</p>
            <label htmlFor="call-audio" className="flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed border-gray-300 px-4 py-4 text-sm text-gray-600 hover:border-primary-300 hover:bg-primary-50/40 focus-within:ring-2 focus-within:ring-primary-500">
              <FileAudio className="h-5 w-5 text-gray-400 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{file ? file.name : 'Choose an audio file…'}</span>
              <input id="call-audio" ref={fileRef} type="file" accept="audio/*" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <Btn className="mt-3 w-full" onClick={upload} disabled={!file || !!busy}>{busy === 'upload' ? 'Uploading & grading…' : 'Upload and grade'}</Btn>
          </Panel>
        </div>
      </div>
    </div>
  );
}
