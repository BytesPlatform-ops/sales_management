'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, ChevronRight, Plus, Pencil, BookOpen } from 'lucide-react';
import { tapi, useTraining } from '@/lib/training/client';
import { Panel, Pill, Btn, Spinner, ErrorNote, Empty, inputCls } from '@/components/training/ui';
import { Modal, Field, Toggle, useToast, Help } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

export const LESSON_TYPES = ['reading', 'video', 'flashcard_deck', 'quiz', 'exam', 'roleplay', 'scenario', 'checklist', 'drill'];
const TYPE_TONE: Record<string, 'gray' | 'blue' | 'violet' | 'amber' | 'green'> = {
  quiz: 'blue', exam: 'violet', drill: 'amber', roleplay: 'green', flashcard_deck: 'blue',
};

/** Order input that saves on blur / Enter. */
function OrderInput({ value, onSave, label }: { value: number; onSave: (n: number) => Promise<void>; label: string }) {
  const [v, setV] = useState(String(value));
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    const n = Number(v);
    if (!Number.isFinite(n) || n === value) { setV(String(value)); return; }
    setSaving(true);
    try { await onSave(n); } finally { setSaving(false); }
  };
  return (
    <input type="number" aria-label={label} title="Order (lower comes first) — saves when you leave the box" value={v} disabled={saving}
      onChange={(e) => setV(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      className="w-14 rounded-md border border-gray-200 px-1.5 py-1 text-xs tabular-nums text-gray-600 focus:outline-none focus:ring-2 focus:ring-primary-500" />
  );
}

function CourseLessons({ courseId, onToast }: { courseId: number; onToast: ReturnType<typeof useToast> }) {
  const router = useRouter();
  const { data, error, mutate } = useTraining<any[]>(`/courses/${courseId}/lessons`);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ code: '', title: '', type: 'reading' });
  async function add() {
    try {
      const l = await tapi<any>('/lessons', { body: { course_id: courseId, ...form } });
      onToast.show('Lesson created (not published yet)');
      router.push(`/hr/training/content/lesson/${l.id}`);
    } catch (e) { onToast.error(e); }
  }
  if (error) return <ErrorNote error={error} />;
  if (!data) return <div className="py-2 pl-8 text-xs text-gray-400">Loading lessons…</div>;
  return (
    <div className="pl-4 sm:pl-8 pb-3">
      {data.length === 0 && <p className="py-2 text-xs text-gray-400">No lessons yet.</p>}
      <ul className="divide-y divide-gray-100">
        {data.map((l) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 py-2">
            <OrderInput value={l.sort_order} label={`Order of ${l.title}`} onSave={async (n) => {
              try { await tapi(`/lessons/${l.id}`, { method: 'PUT', body: { sort_order: n } }); mutate(); } catch (e) { onToast.error(e); }
            }} />
            <span className="font-mono text-xs text-gray-400 w-20 shrink-0">{l.code}</span>
            <Link href={`/hr/training/content/lesson/${l.id}`} className="min-w-0 flex-1 text-sm text-gray-800 hover:text-primary-700 hover:underline">{l.title}</Link>
            <div className="flex flex-wrap items-center gap-1">
              <Pill tone={TYPE_TONE[l.type] || 'gray'}>{l.type.replace('_', ' ')}</Pill>
              {!l.published && <Pill tone="amber">draft</Pill>}
              {!l.required && <Pill>optional</Pill>}
              <span className="text-xs text-gray-400 tabular-nums">v{l.version} · {l.est_minutes} min</span>
            </div>
          </li>
        ))}
      </ul>
      {adding ? (
        <div className="mt-2 grid gap-2 rounded-xl border border-dashed border-primary-300 bg-primary-50/40 p-3 sm:grid-cols-[120px_1fr_160px_auto] sm:items-end">
          <Field label="Code"><input className={cn(inputCls, 'font-mono')} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="C3.6" /></Field>
          <Field label="Title"><input className={inputCls} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
          <Field label="Type"><select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{LESSON_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></Field>
          <div className="flex gap-2"><Btn size="sm" variant="ghost" onClick={() => setAdding(false)}>Cancel</Btn><Btn size="sm" onClick={add} disabled={!form.code.trim() || !form.title.trim()}>Create</Btn></div>
        </div>
      ) : (
        <Btn size="sm" variant="ghost" className="mt-1" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> Add lesson</Btn>
      )}
    </div>
  );
}

function CourseModal({ open, course, trackId, onClose, onSaved }: { open: boolean; course: any | null; trackId: number; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [cur, setCur] = useState<any>(() => course ? { ...course } : { code: '', title: '', description: '', day_number: '', required: true, sort_order: '' });
  const set = (k: string, v: any) => setCur({ ...cur, [k]: v });
  async function save() {
    const body: any = { track_id: trackId, code: cur.code, title: cur.title, description: cur.description || '', required: !!cur.required };
    if (cur.day_number !== '' && cur.day_number !== null) body.day_number = Number(cur.day_number);
    if (cur.sort_order !== '' && cur.sort_order !== null) body.sort_order = Number(cur.sort_order);
    try {
      if (course) await tapi(`/admin/courses/${course.id}`, { method: 'PUT', body });
      else await tapi('/admin/courses', { body });
      onSaved();
    } catch (e) { toast.error(e); }
  }
  return (
    <Modal open={open} onClose={onClose} title={course ? `Edit course ${course.code}` : 'Add a course'}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={!cur.code?.trim() || !cur.title?.trim()}>Save course</Btn></>}>
      {toast.node}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Code"><input className={cn(inputCls, 'font-mono')} value={cur.code} onChange={(e) => set('code', e.target.value)} placeholder="C6" /></Field>
        <Field label="Title" className="sm:col-span-2"><input className={inputCls} value={cur.title} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Description" className="sm:col-span-3"><textarea rows={3} className={inputCls} value={cur.description || ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Onboarding day" help="1, 2 or 3 — shown on the rep's 3-day plan."><input type="number" min={1} className={inputCls} value={cur.day_number ?? ''} onChange={(e) => set('day_number', e.target.value)} /></Field>
        <Field label="Order" help="Lower comes first."><input type="number" className={inputCls} value={cur.sort_order ?? ''} onChange={(e) => set('sort_order', e.target.value)} /></Field>
        <div className="pt-6"><Toggle checked={!!cur.required} onChange={(v) => set('required', v)} label="Required" /></div>
      </div>
    </Modal>
  );
}

function TrackCourses({ track, toast }: { track: any; toast: ReturnType<typeof useToast> }) {
  const { data, error, mutate } = useTraining<any[]>(`/tracks/${track.id}/courses`);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const [editing, setEditing] = useState<any | null | undefined>(undefined);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Spinner label="Loading courses…" />;
  return (
    <div>
      {data.length === 0 && <Empty title="No courses in this track yet" />}
      <ul className="divide-y divide-gray-100 -mx-5">
        {data.map((c) => (
          <li key={c.id}>
            <div className="flex flex-wrap items-center gap-2 px-5 py-2.5 hover:bg-gray-50">
              <button onClick={() => setOpen({ ...open, [c.id]: !open[c.id] })} aria-expanded={!!open[c.id]} className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 rounded">
                {open[c.id] ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronRight className="h-4 w-4 text-gray-400 shrink-0" />}
                <span className="font-mono text-xs text-gray-400 w-12 shrink-0">{c.code}</span>
                <span className="truncate text-sm font-medium text-gray-900">{c.title}</span>
              </button>
              <div className="flex items-center gap-1.5">
                {c.day_number && <Pill tone="blue">Day {c.day_number}</Pill>}
                {!c.required && <Pill>optional</Pill>}
                <span className="text-xs text-gray-400 whitespace-nowrap">{c.lesson_count} published</span>
                <OrderInput value={c.sort_order} label={`Order of ${c.title}`} onSave={async (n) => {
                  try { await tapi(`/admin/courses/${c.id}`, { method: 'PUT', body: { sort_order: n } }); mutate(); } catch (e) { toast.error(e); }
                }} />
                <button className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label={`Edit course ${c.code}`} onClick={() => setEditing(c)}><Pencil className="h-3.5 w-3.5" /></button>
              </div>
            </div>
            {open[c.id] && <div className="px-5"><CourseLessons courseId={c.id} onToast={toast} /></div>}
          </li>
        ))}
      </ul>
      <Btn size="sm" variant="secondary" className="mt-3" onClick={() => setEditing(null)}><Plus className="h-4 w-4" /> Add course</Btn>
      <CourseModal key={editing === undefined ? "closed" : editing?.id ?? "new"} open={editing !== undefined} course={editing ?? null} trackId={track.id} onClose={() => setEditing(undefined)}
        onSaved={() => { setEditing(undefined); toast.show('Course saved'); mutate(); }} />
    </div>
  );
}

export function CurriculumTab() {
  const toast = useToast();
  const { data, error } = useTraining<any[]>('/tracks');
  return (
    <div className="space-y-6">
      {toast.node}
      <Help>
        Tracks hold courses; courses hold lessons. Click a course to see its lessons, click a lesson to edit it.
        Change the small number boxes to reorder (lower comes first) — it saves when you leave the box.
        Lessons marked <Pill tone="amber">draft</Pill> are not visible to reps until you publish them.
      </Help>
      <ErrorNote error={error} />
      {!data ? <Spinner /> : data.map((t) => (
        <Panel key={t.id} title={<span className="flex flex-wrap items-center gap-2 normal-case tracking-normal"><BookOpen className="h-4 w-4" /><span className="text-gray-900 text-base">{t.code} · {t.title}</span>{t.cert_code && <Pill tone="green">→ {t.cert_code}</Pill>}{t.is_placeholder && <Pill>placeholder</Pill>}</span>}>
          {t.description && <p className="-mt-1 mb-3 text-xs text-gray-500">{t.description}</p>}
          <TrackCourses track={t} toast={toast} />
        </Panel>
      ))}
    </div>
  );
}
