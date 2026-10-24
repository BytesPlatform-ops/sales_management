'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2, Pencil, Sparkles, ArrowUp, ArrowDown, X } from 'lucide-react';
import { tapi, useTraining, ApiError } from '@/lib/training/client';
import { Btn, Pill, Empty, Spinner, ErrorNote, StandardModeBanner, inputCls } from '@/components/training/ui';
import { Modal, Field, Toggle, ChipInput, Help, useConfirm, useToast } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';

export const BANK_TAGS = [
  { id: 'product', label: 'Product', help: 'Track 1 exam pool' },
  { id: 'classification', label: 'Classification', help: 'Track 1 exam pool' },
  { id: 'sales', label: 'Sales', help: 'Track 2 exam pool' },
];
const TYPES = [
  { id: 'mcq', label: 'Multiple choice (one answer)' },
  { id: 'multi', label: 'Multiple choice (several answers)' },
  { id: 'true_false', label: 'True / false' },
  { id: 'order', label: 'Put in order' },
  { id: 'short_answer', label: 'Short answer (keywords)' },
];
const TYPE_SHORT: Record<string, string> = { mcq: 'One answer', multi: 'Several answers', true_false: 'True/false', order: 'Order', short_answer: 'Short answer' };

export interface Question {
  id?: number; lesson_id: number | null; type: string; prompt: string; options_json: string[] | null; answer_json: any;
  explanation: string | null; tags: string[]; active: boolean;
}

function shuffled<T>(a: T[]) {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}

/** Plain-English description of the correct answer. */
export function answerText(q: Question) {
  const o = q.options_json || [];
  const a = q.answer_json || {};
  if (q.type === 'mcq' || q.type === 'true_false') return o[a.correct] ?? '—';
  if (q.type === 'multi') return (a.correct || []).map((i: number) => o[i]).join(' · ');
  if (q.type === 'order') return (a.order || []).map((i: number) => o[i]).join(' → ');
  if (q.type === 'short_answer') return `needs ${a.min_matches ?? 1} of: ${(a.keywords || []).join(', ')}`;
  return '—';
}

export function useBankCounts() {
  const { data } = useTraining<Question[]>('/admin/questions');
  return useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of BANK_TAGS) counts[t.id] = (data || []).filter((q) => q.active && q.tags?.includes(t.id)).length;
    return { counts, loaded: !!data };
  }, [data]);
}

function BankCounts({ draw }: { draw?: Record<string, number> }) {
  const { counts, loaded } = useBankCounts();
  if (!loaded) return null;
  return (
    <div className="flex flex-wrap gap-2 text-xs">
      {BANK_TAGS.map((t) => {
        const need = draw?.[t.id];
        const short = need !== undefined && counts[t.id] < need;
        return (
          <span key={t.id} className={cn('rounded-full border px-2.5 py-1', short ? 'border-red-200 bg-red-50 text-red-700' : 'border-gray-200 bg-white text-gray-600')}>
            <strong className="tabular-nums">{counts[t.id]}</strong> active “{t.id}” questions{need !== undefined ? ` · exam draws ${need}` : ''}{short ? ' — not enough!' : ''}
          </span>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ editor modal

function blank(lessonId: number, defaultTag: string): Question {
  return { lesson_id: lessonId, type: 'mcq', prompt: '', options_json: ['', '', '', ''], answer_json: { correct: 0 }, explanation: '', tags: [defaultTag], active: true };
}

function QuestionModal({ open, initial, onClose, onSaved }: { open: boolean; initial: Question | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [q, setQ] = useState<Question | null>(initial);
  const [orderItems, setOrderItems] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setQ(initial);
    if (initial?.type === 'order') {
      const o = initial.options_json || [];
      const ord: number[] = initial.answer_json?.order || o.map((_, i) => i);
      setOrderItems(ord.map((i) => o[i]));
    } else setOrderItems(['', '', '']);
  }, [initial]);
  if (!q) return null;

  const set = (patch: Partial<Question>) => setQ({ ...q, ...patch });
  const opts = q.options_json || [];
  const bank = q.tags.filter((t) => BANK_TAGS.some((b) => b.id === t));
  const extraTags = q.tags.filter((t) => !BANK_TAGS.some((b) => b.id === t));

  function changeType(type: string) {
    if (type === 'true_false') set({ type, options_json: ['True', 'False'], answer_json: { correct: 0 } });
    else if (type === 'short_answer') set({ type, options_json: null, answer_json: { keywords: [], min_matches: 1, model_answer: '' } });
    else if (type === 'order') set({ type, options_json: null, answer_json: { order: [] } });
    else if (type === 'multi') set({ type, options_json: opts.length >= 2 && q!.type !== 'true_false' ? opts : ['', '', '', ''], answer_json: { correct: [] } });
    else set({ type, options_json: opts.length >= 2 && q!.type !== 'true_false' ? opts : ['', '', '', ''], answer_json: { correct: 0 } });
  }

  function problems(): string[] {
    const p: string[] = [];
    if (!q!.prompt.trim()) p.push('Write the question.');
    if (bank.length !== 1) p.push('Pick exactly one exam pool (product, classification or sales) — exams draw questions by this tag.');
    if (q!.type === 'mcq' || q!.type === 'multi') {
      if (opts.filter((o) => o.trim()).length < 2) p.push('Give at least two options.');
      if (opts.some((o) => !o.trim())) p.push('Remove empty options.');
      if (q!.type === 'multi' && !(q!.answer_json?.correct || []).length) p.push('Tick at least one correct option.');
    }
    if (q!.type === 'order' && orderItems.filter((o) => o.trim()).length < 2) p.push('Give at least two items to order.');
    if (q!.type === 'short_answer' && !(q!.answer_json?.keywords || []).length) p.push('Add the keywords a good answer must contain.');
    return p;
  }

  async function save() {
    const errs = problems();
    if (errs.length) return toast.show(errs[0], 'error');
    let body: any = { ...q };
    if (q!.type === 'order') {
      const items = orderItems.map((s) => s.trim()).filter(Boolean);
      // Stored shuffled; the answer key lists the stored indexes in the right order.
      let stored = shuffled(items);
      if (items.length > 1) for (let n = 0; n < 5 && stored.every((s, i) => s === items[i]); n++) stored = shuffled(items);
      body = { ...body, options_json: stored, answer_json: { order: items.map((s) => stored.indexOf(s)) } };
    }
    delete body.id;
    setBusy(true);
    try {
      if (q!.id) await tapi(`/admin/questions/${q!.id}`, { method: 'PUT', body });
      else await tapi('/admin/questions', { body });
      onSaved();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} wide title={q.id ? `Edit question #${q.id}` : 'New question'}
      footer={<><Btn variant="secondary" onClick={onClose}>Cancel</Btn><Btn onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save question'}</Btn></>}>
      {toast.node}
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Question type">
            <select className={inputCls} value={q.type} onChange={(e) => changeType(e.target.value)}>
              {TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Exam pool (required)" help="Final exams draw a set number of questions from each pool.">
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Exam pool">
              {BANK_TAGS.map((b) => (
                <button key={b.id} type="button" role="radio" aria-checked={bank[0] === b.id}
                  onClick={() => set({ tags: [b.id, ...extraTags] })}
                  className={cn('rounded-full border px-3 py-1 text-sm', bank.length === 1 && bank[0] === b.id ? 'border-primary-600 bg-primary-600 text-white' : 'border-gray-300 text-gray-700 hover:border-primary-400')}>
                  {b.label}
                </button>
              ))}
            </div>
          </Field>
        </div>
        <Field label="Question">
          <textarea rows={2} className={inputCls} value={q.prompt} onChange={(e) => set({ prompt: e.target.value })} />
        </Field>

        {(q.type === 'mcq' || q.type === 'multi' || q.type === 'true_false') && (
          <fieldset>
            <legend className="text-sm font-medium text-gray-700">Options — {q.type === 'multi' ? 'tick every correct one' : 'pick the correct one'}</legend>
            <p className="text-xs text-gray-400 mb-2">{q.type === 'true_false' ? 'True/False keep this order.' : 'Reps see these in a random order each attempt.'}</p>
            <div className="space-y-2">
              {opts.map((o, i) => {
                const correct = q.type === 'multi' ? (q.answer_json?.correct || []).includes(i) : q.answer_json?.correct === i;
                return (
                  <div key={i} className="flex items-center gap-2">
                    <input type={q.type === 'multi' ? 'checkbox' : 'radio'} name="correct" checked={correct} aria-label={`Option ${i + 1} is correct`}
                      className="h-4 w-4 text-primary-600 focus:ring-primary-500"
                      onChange={(e) => {
                        if (q.type === 'multi') {
                          const cur: number[] = q.answer_json?.correct || [];
                          set({ answer_json: { correct: e.target.checked ? [...cur, i].sort((a, b) => a - b) : cur.filter((x) => x !== i) } });
                        } else set({ answer_json: { correct: i } });
                      }} />
                    <input className={cn(inputCls, correct && 'border-emerald-400 bg-emerald-50/40')} value={o} disabled={q.type === 'true_false'}
                      onChange={(e) => set({ options_json: opts.map((x, j) => (j === i ? e.target.value : x)) })} placeholder={`Option ${i + 1}`} />
                    {q.type !== 'true_false' && opts.length > 2 && (
                      <button type="button" aria-label={`Remove option ${i + 1}`} className="p-1 text-gray-400 hover:text-red-600"
                        onClick={() => {
                          const a = q.answer_json?.correct;
                          const nextAns = q.type === 'multi'
                            ? { correct: (a || []).filter((x: number) => x !== i).map((x: number) => (x > i ? x - 1 : x)) }
                            : { correct: a === i ? 0 : a > i ? a - 1 : a };
                          set({ options_json: opts.filter((_, j) => j !== i), answer_json: nextAns });
                        }}><X className="h-4 w-4" /></button>
                    )}
                  </div>
                );
              })}
            </div>
            {q.type !== 'true_false' && opts.length < 8 && <Btn size="sm" variant="ghost" className="mt-2" onClick={() => set({ options_json: [...opts, ''] })}><Plus className="h-4 w-4" /> Add option</Btn>}
          </fieldset>
        )}

        {q.type === 'order' && (
          <fieldset>
            <legend className="text-sm font-medium text-gray-700">Items in the CORRECT order</legend>
            <p className="text-xs text-gray-400 mb-2">Type them top-to-bottom in the right order. They are saved shuffled, and reps drag them back into this order.</p>
            <div className="space-y-2">
              {orderItems.map((o, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <span className="w-5 text-right text-xs text-gray-400 tabular-nums">{i + 1}.</span>
                  <input className={inputCls} value={o} onChange={(e) => setOrderItems(orderItems.map((x, j) => (j === i ? e.target.value : x)))} />
                  <button type="button" aria-label="Move up" disabled={i === 0} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" onClick={() => { const a = [...orderItems]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; setOrderItems(a); }}><ArrowUp className="h-4 w-4" /></button>
                  <button type="button" aria-label="Move down" disabled={i === orderItems.length - 1} className="p-1 text-gray-400 hover:text-gray-700 disabled:opacity-30" onClick={() => { const a = [...orderItems]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; setOrderItems(a); }}><ArrowDown className="h-4 w-4" /></button>
                  <button type="button" aria-label="Remove" className="p-1 text-gray-400 hover:text-red-600" onClick={() => setOrderItems(orderItems.filter((_, j) => j !== i))}><X className="h-4 w-4" /></button>
                </div>
              ))}
            </div>
            <Btn size="sm" variant="ghost" className="mt-2" onClick={() => setOrderItems([...orderItems, ''])}><Plus className="h-4 w-4" /> Add item</Btn>
          </fieldset>
        )}

        {q.type === 'short_answer' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-[1fr_auto]">
            <Field label="Keywords a good answer contains" help="Press Enter after each. Matching ignores case. With AI on, answers are also graded for meaning.">
              <ChipInput value={q.answer_json?.keywords || []} onChange={(v) => set({ answer_json: { ...q.answer_json, keywords: v } })} placeholder="e.g. missed calls" />
            </Field>
            <Field label="How many must match">
              <input type="number" min={1} className={cn(inputCls, 'w-24')} value={q.answer_json?.min_matches ?? 1} onChange={(e) => set({ answer_json: { ...q.answer_json, min_matches: Math.max(1, Number(e.target.value) || 1) } })} />
            </Field>
            <Field label="Model answer (shown to reps after they submit)" className="sm:col-span-2">
              <textarea rows={2} className={inputCls} value={q.answer_json?.model_answer || ''} onChange={(e) => set({ answer_json: { ...q.answer_json, model_answer: e.target.value } })} />
            </Field>
          </div>
        )}

        <Field label="Explanation (shown after answering)">
          <textarea rows={2} className={inputCls} value={q.explanation || ''} onChange={(e) => set({ explanation: e.target.value })} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Other tags (optional)" help="e.g. the lesson code. Used for filtering only.">
            <ChipInput value={extraTags} onChange={(v) => set({ tags: [...bank.slice(0, 1), ...v.filter((t) => !BANK_TAGS.some((b) => b.id === t))] })} />
          </Field>
          <div className="pt-6"><Toggle checked={q.active} onChange={(v) => set({ active: v })} label="Active" help="Inactive questions are never shown to reps." /></div>
        </div>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ AI source picker

/** AI generation reads one lesson's text; quiz and deck lessons have little, so let the trainer pick a reading lesson from the course. */
export function useSourceLesson(courseId: number | undefined, selfId: number) {
  const { data } = useTraining<any[]>(courseId ? `/courses/${courseId}/lessons` : null);
  const options = (data || []).filter((l) => ['reading', 'video', 'scenario', 'checklist'].includes(l.type) || l.id === selfId);
  const [picked, setPicked] = useState<number | null>(null);
  const firstReading = options.find((l) => l.id !== selfId);
  const source = picked ?? firstReading?.id ?? selfId;
  const node = (
    <Field label="Generate from" help="The AI reads this lesson’s text. Results are saved into this lesson.">
      <select className={cn(inputCls, 'w-auto max-w-xs')} value={source} onChange={(e) => setPicked(Number(e.target.value))}>
        {options.map((l) => <option key={l.id} value={l.id}>{l.code} · {l.title}{l.id === selfId ? ' (this lesson)' : ''}</option>)}
        {!options.some((l) => l.id === selfId) && <option value={selfId}>This lesson</option>}
      </select>
    </Field>
  );
  return { source, node };
}

// ------------------------------------------------------------------ builder

export function QuizBuilder({ lesson, focusId }: { lesson: { id: number; type: string; code: string; config: any; course_code?: string; course_id?: number }; focusId?: number | null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const isExam = lesson.type === 'exam';
  const list = useTraining<Question[]>(isExam ? null : `/lessons/${lesson.id}/questions`);
  const defaultTag = lesson.course_code?.startsWith('T2') || lesson.code.startsWith('T2') ? 'sales' : 'product';
  const [editing, setEditing] = useState<Question | null>(null);
  const [gen, setGen] = useState<{ prompt: string; options: string[]; correct: number; explanation: string; keep: boolean }[] | null>(null);
  const [genBusy, setGenBusy] = useState(false);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [genCount, setGenCount] = useState(8);
  const src = useSourceLesson(lesson.course_id, lesson.id);
  const [genTag, setGenTag] = useState(defaultTag);
  const { mutate: mutateBank } = useTraining('/admin/questions');

  useEffect(() => {
    if (focusId && list.data) {
      const q = list.data.find((x) => x.id === focusId);
      if (q) setEditing(q);
    }
  }, [focusId, list.data]);

  const refresh = () => { list.mutate(); mutateBank(); };

  async function remove(q: Question) {
    const ok = await confirm.ask({ title: 'Delete this question?', body: <p>“{q.prompt}”<br />Past attempts keep their scores. To hide it without deleting, set it to inactive instead.</p>, confirmLabel: 'Delete' });
    if (ok === null) return;
    try { await tapi(`/admin/questions/${q.id}`, { method: 'DELETE' }); toast.show('Question deleted'); refresh(); } catch (e) { toast.error(e); }
  }
  async function toggleActive(q: Question) {
    try { await tapi(`/admin/questions/${q.id}`, { method: 'PUT', body: { active: !q.active } }); refresh(); } catch (e) { toast.error(e); }
  }
  async function generate() {
    setGenBusy(true); setGenErr(null);
    try {
      const r = await tapi<{ questions: any[] }>('/generate', { body: { lesson_id: src.source, kind: 'quiz', count: genCount } });
      setGen(r.questions.map((x) => ({ ...x, keep: true })));
      if (!r.questions.length) toast.show('The AI did not return usable questions. Try again.', 'info');
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setGenErr(e.message || 'AI is unavailable — standard mode. Write questions by hand.');
      else toast.error(e);
    } finally { setGenBusy(false); }
  }
  async function saveGenerated() {
    const keep = (gen || []).filter((g) => g.keep);
    try {
      for (const g of keep) {
        await tapi('/admin/questions', { body: { lesson_id: lesson.id, type: 'mcq', prompt: g.prompt, options_json: g.options, answer_json: { correct: g.correct }, explanation: g.explanation, tags: [genTag, lesson.code], active: true } });
      }
      toast.show(`${keep.length} question${keep.length === 1 ? '' : 's'} added`);
      setGen(null); refresh();
    } catch (e) { toast.error(e); }
  }

  if (isExam) {
    const draw = lesson.config?.draw_tags || { product: 15, classification: 8, sales: 10 };
    return (
      <div className="space-y-4">
        <Help>
          Final exams don’t have their own questions. Each attempt draws a random set from the whole question bank by exam pool:{' '}
          {Object.entries(draw).map(([t, n]) => `${n} “${t}”`).join(', ')}. Change the numbers in this lesson’s settings (<code>draw_tags</code>), and add questions to the pools from any quiz lesson.
        </Help>
        <BankCounts draw={draw} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toast.node}{confirm.node}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BankCounts />
        <div className="flex gap-2">
          <Btn size="sm" variant="secondary" onClick={() => setGen([])}><Sparkles className="h-4 w-4" /> AI generate</Btn>
          <Btn size="sm" onClick={() => setEditing(blank(lesson.id, defaultTag))}><Plus className="h-4 w-4" /> Add question</Btn>
        </div>
      </div>
      {lesson.config?.draw && <p className="text-xs text-gray-500">Each attempt uses {lesson.config.draw} random questions from this list.</p>}
      <ErrorNote error={list.error} />
      {!list.data ? <Spinner /> : list.data.length === 0 ? <Empty title="No questions yet" body="Add one, or generate a first draft from the lesson text." /> : (
        <ol className="space-y-2">
          {list.data.map((q, i) => (
            <li key={q.id} className={cn('rounded-xl border p-3', q.id === focusId ? 'border-primary-400 ring-2 ring-primary-100' : 'border-gray-200', !q.active && 'opacity-60')}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-gray-900"><span className="text-gray-400 tabular-nums mr-1">{i + 1}.</span>{q.prompt}</div>
                  <div className="mt-1 text-xs text-gray-500"><span className="text-emerald-700">✓ {answerText(q)}</span></div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <Pill>{TYPE_SHORT[q.type] || q.type}</Pill>
                    {q.tags.map((t) => <Pill key={t} tone={BANK_TAGS.some((b) => b.id === t) ? 'blue' : 'gray'}>{t}</Pill>)}
                    {!q.tags.some((t) => BANK_TAGS.some((b) => b.id === t)) && <Pill tone="red">no exam pool</Pill>}
                    {!q.active && <Pill tone="amber">inactive</Pill>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Btn size="sm" variant="ghost" onClick={() => toggleActive(q)}>{q.active ? 'Deactivate' : 'Activate'}</Btn>
                  <button className="rounded p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Edit question" onClick={() => setEditing(q)}><Pencil className="h-4 w-4" /></button>
                  <button className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete question" onClick={() => remove(q)}><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}

      <QuestionModal open={!!editing} initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); toast.show('Question saved'); refresh(); }} />

      <Modal open={gen !== null} onClose={() => { setGen(null); setGenErr(null); }} wide title="Generate quiz questions from the lesson text"
        footer={gen && gen.length > 0 ? <><Btn variant="secondary" onClick={() => setGen(null)}>Discard</Btn><Btn onClick={saveGenerated} disabled={!gen.some((g) => g.keep)}>Save {gen.filter((g) => g.keep).length} selected</Btn></> : undefined}>
        <StandardModeBanner message={genErr} />
        {gen && gen.length === 0 && (
          <div className="flex flex-wrap items-end gap-3">
            {src.node}
            <Field label="How many"><input type="number" min={1} max={20} className={cn(inputCls, 'w-24')} value={genCount} onChange={(e) => setGenCount(Number(e.target.value) || 8)} /></Field>
            <Field label="Exam pool for the new questions">
              <select className={cn(inputCls, 'w-auto')} value={genTag} onChange={(e) => setGenTag(e.target.value)}>{BANK_TAGS.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}</select>
            </Field>
            <Btn onClick={generate} disabled={genBusy}><Sparkles className="h-4 w-4" /> {genBusy ? 'Generating…' : 'Generate'}</Btn>
            <p className="w-full text-xs text-gray-500">The AI reads this lesson’s text and drafts one-answer questions. Nothing is saved until you pick the ones to keep.</p>
          </div>
        )}
        {gen && gen.length > 0 && (
          <ul className="space-y-2">
            {gen.map((g, i) => (
              <li key={i} className="rounded-xl border border-gray-200 p-3">
                <label className="flex items-start gap-2">
                  <input type="checkbox" className="mt-1" checked={g.keep} onChange={(e) => setGen(gen.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                  <span className="min-w-0 text-sm">
                    <span className="font-medium text-gray-900">{g.prompt}</span>
                    <span className="mt-1 block text-xs text-gray-500">{g.options.map((o, j) => <span key={j} className={cn('mr-2', j === g.correct && 'font-semibold text-emerald-700')}>{j === g.correct ? '✓ ' : ''}{o}</span>)}</span>
                    {g.explanation && <span className="mt-1 block text-xs italic text-gray-400">{g.explanation}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
