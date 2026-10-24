'use client';

import { useMemo, useState } from 'react';
import { Trash2, Send } from 'lucide-react';
import { tapi, useTraining, fmtDate } from '@/lib/training/client';
import { Panel, PhaseBadge, Spinner, ErrorNote, Empty, Btn, Pill, inputCls } from '@/components/training/ui';
import { TrainerPage, Field, TableWrap, th, td, useConfirm, useToast } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

export default function AssignPage() {
  const toast = useToast();
  const confirm = useConfirm();
  const users = useTraining<any[]>('/users?role=rep');
  const tracks = useTraining<any[]>('/tracks');
  const assignments = useTraining<any[]>('/assignments');
  const [selected, setSelected] = useState<number[]>([]);
  const [trackId, setTrackId] = useState<string>('');
  const courses = useTraining<any[]>(trackId ? `/tracks/${trackId}/courses` : null);
  const [courseId, setCourseId] = useState<string>('');
  const [due, setDue] = useState('');
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<'all' | 'training'>('all');

  const reps = useMemo(() => (users.data || []).filter((u) => filter === 'all' || u.phase === 'TRAINING'), [users.data, filter]);
  const allOn = reps.length > 0 && reps.every((r) => selected.includes(Number(r.id)));
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  async function assign() {
    const target = courseId ? courses.data?.find((c) => String(c.id) === courseId)?.title : tracks.data?.find((t) => String(t.id) === trackId)?.title;
    setBusy(true);
    try {
      const body: any = { user_ids: selected, due_at: due ? new Date(`${due}T23:59:00`).toISOString() : null };
      if (courseId) body.course_id = Number(courseId); else body.track_id = Number(trackId);
      const r = await tapi<any[]>('/assignments', { body });
      toast.show(`Assigned “${target}” to ${r.length} rep${r.length === 1 ? '' : 's'}. They were notified.`);
      setSelected([]); assignments.mutate();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  async function remove(a: any) {
    const ok = await confirm.ask({ title: 'Remove this assignment?', body: <p>{a.full_name} — {a.course_title || a.track_title}. Their progress is kept; only the due date / reminder goes away.</p>, confirmLabel: 'Remove' });
    if (ok === null) return;
    try { await tapi(`/assignments?id=${a.id}`, { method: 'DELETE' }); toast.show('Assignment removed'); assignments.mutate(); } catch (e) { toast.error(e); }
  }

  return (
    <TrainerPage title="Assign training" subtitle="Give reps a track or a single course with a due date. Assigned reps get a notification and see the due date on their path.">
      {toast.node}{confirm.node}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="1 · Pick reps" action={
          <select aria-label="Filter reps" className={cn(inputCls, 'w-auto py-1 text-xs')} value={filter} onChange={(e) => setFilter(e.target.value as any)}>
            <option value="all">All active reps</option><option value="training">Only reps in Training</option>
          </select>}>
          <ErrorNote error={users.error} />
          {!users.data ? <Spinner /> : reps.length === 0 ? <Empty title="No reps match" /> : (
            <>
              <label className="mb-2 flex items-center gap-2 border-b border-gray-100 pb-2 text-sm font-medium text-gray-700">
                <input type="checkbox" checked={allOn} onChange={() => setSelected(allOn ? selected.filter((id) => !reps.some((r) => Number(r.id) === id)) : Array.from(new Set([...selected, ...reps.map((r) => Number(r.id))])))} />
                Select all ({reps.length})
              </label>
              <ul className="max-h-[420px] overflow-y-auto divide-y divide-gray-50">
                {reps.map((u) => (
                  <li key={u.id}>
                    <label className="flex cursor-pointer items-center gap-3 py-2 text-sm hover:bg-gray-50 rounded-lg px-1">
                      <input type="checkbox" checked={selected.includes(Number(u.id))} onChange={() => toggle(Number(u.id))} />
                      <span className="min-w-0 flex-1"><span className="font-medium text-gray-900">{u.full_name}</span> <span className="text-xs text-gray-400">@{u.username}</span></span>
                      <PhaseBadge phase={u.phase} />
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Panel>
        <Panel title="2 · What and when" className="h-fit">
          <div className="space-y-4">
            <Field label="Track">
              <select className={inputCls} value={trackId} onChange={(e) => { setTrackId(e.target.value); setCourseId(''); }}>
                <option value="">Choose a track…</option>
                {(tracks.data || []).map((t) => <option key={t.id} value={t.id}>{t.code} · {t.title}</option>)}
              </select>
            </Field>
            <Field label="Course (optional)" help="Leave as “Whole track” to assign every course in the track.">
              <select className={inputCls} value={courseId} onChange={(e) => setCourseId(e.target.value)} disabled={!trackId}>
                <option value="">Whole track</option>
                {(courses.data || []).map((c) => <option key={c.id} value={c.id}>{c.code} · {c.title}</option>)}
              </select>
            </Field>
            <Field label="Due date (optional)"><input type="date" className={inputCls} value={due} onChange={(e) => setDue(e.target.value)} /></Field>
            <Btn className="w-full" onClick={assign} disabled={busy || !selected.length || !trackId}><Send className="h-4 w-4" /> {busy ? 'Assigning…' : `Assign to ${selected.length} rep${selected.length === 1 ? '' : 's'}`}</Btn>
          </div>
        </Panel>
      </div>

      <Panel title="Current assignments" className="mt-6">
        <ErrorNote error={assignments.error} />
        {!assignments.data ? <Spinner /> : assignments.data.length === 0 ? <Empty title="Nothing assigned yet" /> : (
          <TableWrap>
            <thead className="bg-gray-50"><tr><th className={th}>Rep</th><th className={th}>Training</th><th className={th}>Due</th><th className={th}>Assigned</th><th className={th}></th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {assignments.data.map((a) => {
                const overdue = a.due_at && new Date(a.due_at) < new Date();
                return (
                  <tr key={a.id}>
                    <td className={cn(td, 'font-medium text-gray-900 whitespace-nowrap')}>{a.full_name}</td>
                    <td className={td}>{a.course_id ? <><Pill tone="blue">course</Pill> {a.course_code} · {a.course_title}</> : <><Pill tone="violet">track</Pill> {a.track_code} · {a.track_title}</>}</td>
                    <td className={cn(td, 'whitespace-nowrap', overdue && 'text-red-600 font-medium')}>{a.due_at ? fmtDate(a.due_at) : '—'}{overdue && ' · overdue'}</td>
                    <td className={cn(td, 'whitespace-nowrap text-gray-500')}>{fmtDate(a.created_at)}{a.assigned_by_name ? ` by ${a.assigned_by_name}` : ''}</td>
                    <td className={cn(td, 'text-right')}><button className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label={`Remove assignment for ${a.full_name}`} onClick={() => remove(a)}><Trash2 className="h-4 w-4" /></button></td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        )}
      </Panel>
    </TrainerPage>
  );
}
