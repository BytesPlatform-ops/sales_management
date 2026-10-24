'use client';

import { useState } from 'react';
import { Plus, Trash2, Sparkles, Upload, Pencil, Check, X } from 'lucide-react';
import { tapi, useTraining, ApiError } from '@/lib/training/client';
import { Btn, Pill, Empty, Spinner, ErrorNote, StandardModeBanner, inputCls } from '@/components/training/ui';
import { Modal, Field, useConfirm, useToast, ChipInput } from '@/components/training/hr/kit';
import { cn } from '@/lib/utils';
import { useSourceLesson } from './quiz-builder';

interface Card { id: number; deck_lesson_id: number; front: string; back: string; tags: string[]; sort_order: number }

const SAMPLE = `front,back,tags
What is a set-aside?,A contract reserved for a type of small business (e.g. 8(a) or WOSB),glossary;C1
"NAICS code","The industry code for the type of work, e.g. 561612 security guards",glossary`;

function CardRow({ card, onSaved, onDelete }: { card: Card; onSaved: () => void; onDelete: () => void }) {
  const toast = useToast();
  const [edit, setEdit] = useState(false);
  const [front, setFront] = useState(card.front);
  const [back, setBack] = useState(card.back);
  const [tags, setTags] = useState<string[]>(card.tags || []);
  async function save() {
    try { await tapi(`/admin/flashcards/${card.id}`, { method: 'PUT', body: { front, back, tags } }); setEdit(false); onSaved(); } catch (e) { toast.error(e); }
  }
  if (edit) {
    return (
      <li className="rounded-xl border border-primary-300 p-3 space-y-2">
        {toast.node}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <textarea aria-label="Front" rows={2} className={inputCls} value={front} onChange={(e) => setFront(e.target.value)} />
          <textarea aria-label="Back" rows={2} className={inputCls} value={back} onChange={(e) => setBack(e.target.value)} />
        </div>
        <ChipInput value={tags} onChange={setTags} placeholder="tags" />
        <div className="flex justify-end gap-2">
          <Btn size="sm" variant="ghost" onClick={() => { setEdit(false); setFront(card.front); setBack(card.back); setTags(card.tags || []); }}><X className="h-4 w-4" /> Cancel</Btn>
          <Btn size="sm" onClick={save} disabled={!front.trim() || !back.trim()}><Check className="h-4 w-4" /> Save</Btn>
        </div>
      </li>
    );
  }
  return (
    <li className="grid grid-cols-1 gap-2 rounded-xl border border-gray-200 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
      <div className="text-sm font-medium text-gray-900">{card.front}</div>
      <div className="text-sm text-gray-600">{card.back}{card.tags?.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{card.tags.map((t) => <Pill key={t}>{t}</Pill>)}</div>}</div>
      <div className="flex gap-1 sm:justify-end">
        <button className="rounded p-1.5 text-gray-500 hover:bg-gray-100" aria-label="Edit card" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" /></button>
        <button className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete card" onClick={onDelete}><Trash2 className="h-4 w-4" /></button>
      </div>
    </li>
  );
}

export function FlashcardManager({ lessonId, courseId }: { lessonId: number; courseId?: number }) {
  const toast = useToast();
  const confirm = useConfirm();
  const list = useTraining<Card[]>(`/admin/flashcards?deck_lesson_id=${lessonId}`);
  const [adding, setAdding] = useState(false);
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [csvOpen, setCsvOpen] = useState(false);
  const [csv, setCsv] = useState('');
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState<{ front: string; back: string; keep: boolean }[] | null>(null);
  const [genErr, setGenErr] = useState<string | null>(null);
  const [genCount, setGenCount] = useState(10);
  const src = useSourceLesson(courseId, lessonId);

  async function add() {
    try {
      await tapi('/admin/flashcards', { body: { deck_lesson_id: lessonId, front, back, tags: [], sort_order: (list.data?.length || 0) + 1 } });
      setFront(''); setBack(''); toast.show('Card added'); list.mutate();
    } catch (e) { toast.error(e); }
  }
  async function remove(c: Card) {
    const ok = await confirm.ask({ title: 'Delete this card?', body: <p>“{c.front}”. Reps lose its review history.</p>, confirmLabel: 'Delete' });
    if (ok === null) return;
    try { await tapi(`/admin/flashcards/${c.id}`, { method: 'DELETE' }); list.mutate(); toast.show('Card deleted'); } catch (e) { toast.error(e); }
  }
  async function importCsv() {
    setBusy(true);
    try {
      const r = await tapi<{ imported: number }>(`/lessons/${lessonId}/flashcards`, { body: { csv } });
      toast.show(`${r.imported} card${r.imported === 1 ? '' : 's'} imported`);
      setCsv(''); setCsvOpen(false); list.mutate();
    } catch (e) { toast.error(e); } finally { setBusy(false); }
  }
  async function readFile(f: File | undefined) {
    if (!f) return;
    setCsv(await f.text());
  }
  async function generate() {
    setBusy(true); setGenErr(null);
    try {
      const r = await tapi<{ cards: { front: string; back: string }[] }>('/generate', { body: { lesson_id: src.source, kind: 'flashcards', count: genCount } });
      setGen(r.cards.map((c) => ({ ...c, keep: true })));
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setGenErr(e.message || 'AI is unavailable — standard mode.');
      else toast.error(e);
    } finally { setBusy(false); }
  }
  async function saveGenerated() {
    const cards = (gen || []).filter((g) => g.keep).map(({ front, back }) => ({ front, back, tags: [] }));
    try {
      await tapi(`/lessons/${lessonId}/flashcards`, { body: { cards } });
      toast.show(`${cards.length} cards added`); setGen(null); list.mutate();
    } catch (e) { toast.error(e); }
  }

  const csvRows = csv.trim() ? csv.trim().split(/\r?\n/).filter((l) => l.trim() && !/^front\s*,\s*back/i.test(l)).length : 0;

  return (
    <div className="space-y-4">
      {toast.node}{confirm.node}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-gray-500">{list.data ? `${list.data.length} cards. Reps review these with spaced repetition after opening the deck.` : ''}</p>
        <div className="flex flex-wrap gap-2">
          <Btn size="sm" variant="secondary" onClick={() => setCsvOpen(true)}><Upload className="h-4 w-4" /> Import CSV</Btn>
          <Btn size="sm" variant="secondary" onClick={() => setGen([])}><Sparkles className="h-4 w-4" /> AI generate</Btn>
          <Btn size="sm" onClick={() => setAdding(!adding)}><Plus className="h-4 w-4" /> Add card</Btn>
        </div>
      </div>
      {adding && (
        <div className="rounded-xl border border-dashed border-primary-300 bg-primary-50/40 p-3 space-y-2">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <Field label="Front (question / term)"><textarea rows={2} className={inputCls} value={front} onChange={(e) => setFront(e.target.value)} /></Field>
            <Field label="Back (answer)"><textarea rows={2} className={inputCls} value={back} onChange={(e) => setBack(e.target.value)} /></Field>
          </div>
          <div className="flex justify-end"><Btn size="sm" onClick={add} disabled={!front.trim() || !back.trim()}>Add card</Btn></div>
        </div>
      )}
      <ErrorNote error={list.error} />
      {!list.data ? <Spinner /> : list.data.length === 0 ? <Empty title="No cards yet" body="Add cards one by one, import a CSV, or generate from the lesson text." /> : (
        <ul className="space-y-2">{list.data.map((c) => <CardRow key={c.id} card={c} onSaved={() => list.mutate()} onDelete={() => remove(c)} />)}</ul>
      )}

      <Modal open={csvOpen} onClose={() => setCsvOpen(false)} wide title="Import flashcards from CSV"
        footer={<><Btn variant="secondary" onClick={() => setCsvOpen(false)}>Cancel</Btn><Btn onClick={importCsv} disabled={busy || !csvRows}>{busy ? 'Importing…' : `Import ${csvRows || ''} card${csvRows === 1 ? '' : 's'}`}</Btn></>}>
        <p className="text-sm text-gray-600">One card per line: <code className="rounded bg-gray-100 px-1">front,back,tags</code>. Tags are optional and separated by <code className="rounded bg-gray-100 px-1">;</code>. Put text containing commas in double quotes. A header row is skipped. Cards are added to the end of the deck (existing cards are kept).</p>
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 text-sm text-primary-700 hover:underline">
          <Upload className="h-4 w-4" /> Choose a .csv file
          <input type="file" accept=".csv,text/csv,text/plain" className="sr-only" onChange={(e) => readFile(e.target.files?.[0])} />
        </label>
        <textarea rows={10} spellCheck={false} className={cn(inputCls, 'mt-2 font-mono text-xs')} value={csv} onChange={(e) => setCsv(e.target.value)} placeholder={SAMPLE} aria-label="CSV text" />
        <button type="button" className="mt-1 text-xs text-gray-500 hover:underline" onClick={() => setCsv(SAMPLE)}>Paste an example</button>
      </Modal>

      <Modal open={gen !== null} onClose={() => { setGen(null); setGenErr(null); }} wide title="Generate flashcards from the lesson text"
        footer={gen && gen.length > 0 ? <><Btn variant="secondary" onClick={() => setGen(null)}>Discard</Btn><Btn onClick={saveGenerated} disabled={!gen.some((g) => g.keep)}>Save {gen.filter((g) => g.keep).length} selected</Btn></> : undefined}>
        <StandardModeBanner message={genErr} />
        {gen && gen.length === 0 && (
          <div className="flex flex-wrap items-end gap-3">
            {src.node}
            <Field label="How many"><input type="number" min={1} max={30} className={cn(inputCls, 'w-24')} value={genCount} onChange={(e) => setGenCount(Number(e.target.value) || 10)} /></Field>
            <Btn onClick={generate} disabled={busy}><Sparkles className="h-4 w-4" /> {busy ? 'Generating…' : 'Generate'}</Btn>
            <p className="w-full text-xs text-gray-500">Generated from the lesson you pick above and added to this deck. Nothing is saved until you pick the cards to keep.</p>
          </div>
        )}
        {gen && gen.length > 0 && (
          <ul className="space-y-2">
            {gen.map((g, i) => (
              <li key={i} className="rounded-xl border border-gray-200 p-3">
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1" checked={g.keep} onChange={(e) => setGen(gen.map((x, j) => (j === i ? { ...x, keep: e.target.checked } : x)))} />
                  <span><span className="font-medium text-gray-900">{g.front}</span><span className="block text-gray-600">{g.back}</span></span>
                </label>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
