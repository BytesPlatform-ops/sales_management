'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Save, UploadCloud, Trash2, History } from 'lucide-react';
import { tapi, useTraining, fmtDate } from '@/lib/training/client';
import { Panel, Spinner, ErrorNote, Pill, Btn, Empty, inputCls } from '@/components/training/ui';
import { Markdown } from '@/components/training/markdown';
import { TrainerPage, Field, Toggle, Tabs, JsonEditor, parseJson, Help, useConfirm, useToast } from '@/components/training/hr/kit';
import { QuizBuilder } from '@/components/training/hr/content/quiz-builder';
import { FlashcardManager } from '@/components/training/hr/content/flashcards';
import { LESSON_TYPES } from '@/components/training/hr/content/curriculum';
import { cn } from '@/lib/utils';



const CONFIG_HELP: Record<string, { text: string; example: any }> = {
  reading: { text: 'Usually empty: {}. Reps mark reading lessons complete themselves.', example: {} },
  video: { text: 'Usually empty: {}. Put the video link in “Media URL”.', example: {} },
  scenario: { text: 'Usually empty: {}. Self-completed by the rep.', example: {} },
  flashcard_deck: { text: 'Usually empty: {}. Manage the cards on the Flashcards tab.', example: {} },
  quiz: { text: 'Optional "draw": how many random questions from this quiz’s list each attempt uses (leave out to use all).', example: { draw: 10 } },
  exam: {
    text: '"draw_tags": how many questions to draw from each exam pool (product / classification / sales). "time_limit_min": minutes allowed; the attempt is submitted when time runs out.',
    example: { draw_tags: { product: 15, classification: 8 }, time_limit_min: 30 },
  },
  drill: {
    text: '"kind": "classification" (SAM.gov rows → pick the service) or "objection" (reply to objections from the library). "count": how many items per attempt.',
    example: { kind: 'classification', count: 10 },
  },
  roleplay: {
    text: '"scenario_codes": which roleplay personas count (codes from the Personas tab). "purpose": "practice" or "exam". "min_sessions": how many sessions the rep must finish. "min_score": the score each one needs (out of 100).',
    example: { scenario_codes: ['RP1'], purpose: 'practice', min_sessions: 1, min_score: 50 },
  },
  checklist: { text: '"items": the list of things the rep ticks off before marking the lesson complete.', example: { items: ['Logged in to the dialer', 'Read the call script'] } },
};

function validateConfig(type: string, scenarioCodes: string[]) {
  return (c: any): string[] => {
    const p: string[] = [];
    if (typeof c !== 'object' || Array.isArray(c)) return ['Settings must be an object like { … }'];
    const num = (k: string) => c[k] !== undefined && !(typeof c[k] === 'number' && c[k] >= 0) && p.push(`"${k}" must be a number`);
    if (type === 'exam') {
      if (c.draw_tags !== undefined) {
        if (typeof c.draw_tags !== 'object' || Array.isArray(c.draw_tags)) p.push('"draw_tags" must look like { "product": 15 }');
        else for (const [k, v] of Object.entries(c.draw_tags)) {
          if (!['product', 'classification', 'sales'].includes(k)) p.push(`"draw_tags" has an unknown pool "${k}" (use product, classification or sales)`);
          if (!(typeof v === 'number' && v >= 0)) p.push(`"draw_tags.${k}" must be a number`);
        }
      }
      num('time_limit_min');
    }
    if (type === 'quiz') num('draw');
    if (type === 'drill') {
      if (!['classification', 'objection'].includes(c.kind)) p.push('"kind" must be "classification" or "objection"');
      num('count');
    }
    if (type === 'roleplay') {
      if (c.scenario_codes !== undefined && !Array.isArray(c.scenario_codes)) p.push('"scenario_codes" must be a list like ["RP1", "RP2"]');
      else for (const code of c.scenario_codes || []) if (scenarioCodes.length && !scenarioCodes.includes(code)) p.push(`No persona with code "${code}"`);
      if (c.purpose !== undefined && !['practice', 'exam', 'daily'].includes(c.purpose)) p.push('"purpose" must be "practice" or "exam"');
      num('min_sessions'); num('min_score');
    }
    if (type === 'checklist' && c.items !== undefined && !(Array.isArray(c.items) && c.items.every((x: any) => typeof x === 'string'))) p.push('"items" must be a list of text items');
    return p;
  };
}

export default function LessonEditorPage() {
  return <Suspense fallback={<Spinner />}><LessonEditor /></Suspense>;
}

function LessonEditor() {
  const { id } = useParams<{ id: string }>();
  const sp = useSearchParams();
  const router = useRouter();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, error, mutate } = useTraining<any>(`/lessons/${id}`);
  const versions = useTraining<any[]>(`/lessons/${id}/publish`);
  const scenarios = useTraining<any[]>('/admin/scenarios');
  const lesson = data?.lesson;
  const [form, setForm] = useState<any>(null);
  const [configText, setConfigText] = useState('{}');
  const [view, setView] = useState<'write' | 'preview'>('write');
  const [busy, setBusy] = useState(false);
  const focusQ = sp.get('q') ? Number(sp.get('q')) : null;
  const hasQuestions = lesson && ['quiz', 'exam'].includes(lesson.type);
  const hasCards = lesson?.type === 'flashcard_deck';
  const [tab, setTab] = useState<string>(sp.get('tab') || 'content');

  useEffect(() => {
    if (!lesson) return;
    setForm({
      title: lesson.title, code: lesson.code, type: lesson.type, est_minutes: lesson.est_minutes, pass_pct: lesson.pass_pct,
      required: lesson.required, published: lesson.published, body_md: lesson.body_md || '', media_url: lesson.media_url || '', sort_order: lesson.sort_order,
    });
    setConfigText(JSON.stringify(lesson.config || {}, null, 2));
  }, [lesson]);

  const scenarioCodes = useMemo(() => (scenarios.data || []).map((s) => s.code), [scenarios.data]);
  const cfg = parseJson(configText);
  const cfgProblems = form && cfg.ok && cfg.value ? validateConfig(form.type, scenarioCodes)(cfg.value) : [];
  const dirty = !!(lesson && form) && (
    ['title', 'code', 'type', 'est_minutes', 'pass_pct', 'required', 'published', 'body_md', 'sort_order'].some((k) => String(form[k] ?? '') !== String(lesson[k] ?? '')) ||
    (form.media_url || '') !== (lesson.media_url || '') ||
    (cfg.ok && JSON.stringify(cfg.value || {}) !== JSON.stringify(lesson.config || {}))
  );

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  async function save(quiet = false) {
    if (!cfg.ok) { toast.show('Fix the settings JSON first', 'error'); return false; }
    if (cfgProblems.length) { toast.show(cfgProblems[0], 'error'); return false; }
    if (!form.title.trim() || !form.code.trim()) { toast.show('Title and code are required', 'error'); return false; }
    setBusy(true);
    try {
      await tapi(`/lessons/${id}`, { method: 'PUT', body: {
        ...form, est_minutes: Number(form.est_minutes) || 0, pass_pct: Number(form.pass_pct) || 0, sort_order: Number(form.sort_order) || 0,
        media_url: form.media_url || null, config: cfg.value || {},
      } });
      await mutate();
      if (!quiet) toast.show('Saved');
      return true;
    } catch (e) { toast.error(e); return false; } finally { setBusy(false); }
  }
  async function publish() {
    const ok = await confirm.ask({ title: 'Publish this lesson?', body: <p>Reps will see it in their path, and a new numbered version is recorded in the history{lesson.version ? ` (this will be v${versions.data?.length ? lesson.version + 1 : lesson.version})` : ''}.</p>, confirmLabel: 'Publish', tone: 'primary' });
    if (ok === null) return;
    if (dirty && !(await save(true))) return;
    setBusy(true);
    try {
      const r = await tapi<any>(`/lessons/${id}/publish`, { body: {} });
      toast.show(`Published as version ${r.version}`);
      mutate(); versions.mutate();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  async function remove() {
    const ok = await confirm.ask({ title: `Delete “${lesson.title}”?`, body: <p>If any rep has started or attempted this lesson it is <strong>unpublished instead</strong> (hidden from reps, history kept). Otherwise it is deleted permanently.</p>, confirmLabel: 'Delete' });
    if (ok === null) return;
    try {
      const r = await tapi<any>(`/lessons/${id}`, { method: 'DELETE' });
      if (r.unpublished) { toast.show(r.note || 'Unpublished instead of deleted', 'info', 7000); mutate(); }
      else { router.push('/hr/training/content?tab=curriculum'); }
    } catch (e) { toast.error(e); }
  }

  const back = { href: '/hr/training/content?tab=curriculum', label: 'Curriculum' };
  if (error) return <TrainerPage title="Lesson" back={back}><ErrorNote error={error} /></TrainerPage>;
  if (!lesson || !form) return <TrainerPage title="Lesson" back={back}><Spinner /></TrainerPage>;
  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const help = CONFIG_HELP[form.type] || CONFIG_HELP.reading;
  const tabs = [
    { id: 'content', label: 'Lesson' },
    ...(hasQuestions ? [{ id: 'questions', label: lesson.type === 'exam' ? 'Question pools' : 'Questions' }] : []),
    ...(hasCards ? [{ id: 'flashcards', label: 'Flashcards' }] : []),
    { id: 'versions', label: `Versions${versions.data?.length ? ` (${versions.data.length})` : ''}` },
  ];

  return (
    <TrainerPage
      title={form.title || 'Untitled lesson'}
      back={back}
      subtitle={<>{lesson.track_code} › {lesson.course_code} {lesson.course_title} · <span className="font-mono">{lesson.code}</span> · v{lesson.version}</>}
      actions={<>
        {lesson.published ? <Pill tone="green">Published</Pill> : <Pill tone="amber">Not published</Pill>}
        {dirty && <Pill tone="violet">Unsaved changes</Pill>}
        <Btn size="sm" variant="secondary" onClick={() => save()} disabled={busy || !dirty}><Save className="h-4 w-4" /> Save</Btn>
        <Btn size="sm" onClick={publish} disabled={busy}><UploadCloud className="h-4 w-4" /> Publish</Btn>
      </>}
    >
      {toast.node}{confirm.node}
      <Tabs className="mb-4 w-fit" tabs={tabs} value={tab} onChange={setTab} />

      {tab === 'content' && (
        <div className="space-y-6">
          <Help>
            <strong>How saving works:</strong> “Save” updates the lesson right away{lesson.published ? ' — this lesson is published, so reps see the change on their next visit' : ''}. “Publish” makes it visible to reps and records a numbered version you can look back on. New lessons start unpublished.
          </Help>
          <Panel title="Details">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Title" className="sm:col-span-2"><input className={inputCls} value={form.title} onChange={(e) => set('title', e.target.value)} /></Field>
              <Field label="Code" help="Short unique ID, e.g. C3.2. Gates refer to lessons by code."><input className={cn(inputCls, 'font-mono')} value={form.code} onChange={(e) => set('code', e.target.value)} /></Field>
              <Field label="Type">
                <select className={inputCls} value={form.type} onChange={(e) => set('type', e.target.value)}>{LESSON_TYPES.map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select>
              </Field>
              <Field label="Estimated minutes"><input type="number" min={0} className={inputCls} value={form.est_minutes} onChange={(e) => set('est_minutes', e.target.value)} /></Field>
              <Field label="Pass mark (%)" help="For quizzes, exams and drills."><input type="number" min={0} max={100} className={inputCls} value={form.pass_pct} onChange={(e) => set('pass_pct', e.target.value)} /></Field>
              <Field label="Order in course" help="Lower comes first."><input type="number" className={inputCls} value={form.sort_order} onChange={(e) => set('sort_order', e.target.value)} /></Field>
              {form.type === 'video' && <Field label="Media URL" className="sm:col-span-2 lg:col-span-1"><input className={inputCls} value={form.media_url} onChange={(e) => set('media_url', e.target.value)} placeholder="https://…" /></Field>}
            </div>
            <div className="mt-4 flex flex-wrap gap-6">
              <Toggle checked={form.required} onChange={(v) => set('required', v)} label="Required" help="Required lessons must be finished to complete the course." />
              <Toggle checked={form.published} onChange={(v) => set('published', v)} label="Visible to reps" help="Switch off and Save to hide (unpublish) the lesson." />
            </div>
          </Panel>

          <Panel title="Lesson settings (JSON)">
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
              <JsonEditor value={configText} onChange={setConfigText} rows={8} validate={validateConfig(form.type, scenarioCodes)} />
              <div className="text-xs text-gray-600 space-y-2">
                <p><strong className="text-gray-800">For a {form.type.replace('_', ' ')} lesson:</strong> {help.text}</p>
                <p className="text-gray-500">Example:</p>
                <pre className="rounded-lg bg-gray-50 p-2 font-mono text-[11px] overflow-x-auto">{JSON.stringify(help.example, null, 2)}</pre>
                <button type="button" className="text-primary-600 hover:underline" onClick={() => setConfigText(JSON.stringify(help.example, null, 2))}>Use the example</button>
                {form.type === 'roleplay' && scenarioCodes.length > 0 && <p className="text-gray-500">Persona codes: {scenarioCodes.join(', ')}</p>}
              </div>
            </div>
          </Panel>

          <Panel title="Lesson text (Markdown)" action={
            <div className="lg:hidden"><Tabs tabs={[{ id: 'write', label: 'Write' }, { id: 'preview', label: 'Preview' }]} value={view} onChange={setView} /></div>
          }>
            <p className="mb-3 text-xs text-gray-500"># Heading · **bold** · *italic* · - bullet list · 1. numbered list · [link](https://…) · | tables | · &gt; quote</p>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              <div className={cn(view === 'preview' && 'hidden lg:block')}>
                <textarea aria-label="Lesson text in Markdown" rows={24} spellCheck className={cn(inputCls, 'font-mono text-sm leading-6 min-h-[420px]')} value={form.body_md} onChange={(e) => set('body_md', e.target.value)} />
                <div className="mt-1 text-xs text-gray-400 tabular-nums">{form.body_md.split(/\s+/).filter(Boolean).length} words</div>
              </div>
              <div className={cn('rounded-xl border border-gray-200 p-4 overflow-y-auto max-h-[640px]', view === 'write' && 'hidden lg:block')} aria-label="Preview">
                {form.body_md.trim() ? <Markdown source={form.body_md} /> : <p className="text-sm text-gray-400">Nothing to preview yet.</p>}
              </div>
            </div>
          </Panel>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <Btn variant="ghost" className="text-red-600 hover:bg-red-50" onClick={remove}><Trash2 className="h-4 w-4" /> Delete lesson</Btn>
            <div className="flex gap-2">
              <Btn variant="secondary" onClick={() => save()} disabled={busy || !dirty}><Save className="h-4 w-4" /> Save</Btn>
              <Btn onClick={publish} disabled={busy}><UploadCloud className="h-4 w-4" /> Publish</Btn>
            </div>
          </div>
        </div>
      )}

      {tab === 'questions' && hasQuestions && (
        <Panel title={lesson.type === 'exam' ? 'Exam question pools' : 'Quiz questions'}>
          <QuizBuilder lesson={{ id: lesson.id, type: lesson.type, code: lesson.code, config: lesson.config, course_code: lesson.track_code, course_id: lesson.course_id }} focusId={focusQ} />
        </Panel>
      )}
      {tab === 'flashcards' && hasCards && <Panel title="Flashcards"><FlashcardManager lessonId={lesson.id} courseId={lesson.course_id} /></Panel>}
      {tab === 'versions' && (
        <Panel title="Published versions">
          {!versions.data ? <Spinner /> : versions.data.length === 0 ? <Empty icon={<History className="h-5 w-5" />} title="Never published" body="Publishing records a snapshot of the title, text and settings." /> : (
            <ol className="space-y-2">
              {versions.data.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm">
                  <span><strong className="tabular-nums">v{v.version}</strong> · {v.title}</span>
                  <span className="text-xs text-gray-500">{fmtDate(v.published_at, true)}{v.published_by ? ` by ${v.published_by}` : ''}{v.version === lesson.version && lesson.published ? ' · current' : ''}</span>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      )}
    </TrainerPage>
  );
}
