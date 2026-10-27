'use client';

import { useRef, useState } from 'react';
import { Bold, Italic, List, ListOrdered, Link2, Code, Eye, Pencil } from 'lucide-react';
import { cn } from '@/lib/utils';
import { inputCls } from '@/components/training/ui';
import { Markdown } from '@/components/training/markdown';

/**
 * Plain-text editing with a small formatting toolbar and a preview. Stored as
 * Markdown and rendered by the app's safe Markdown component (no raw HTML).
 */
export function MarkdownEditor({ value, onChange, rows = 6, placeholder, id, autoFocus }: {
  value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; id?: string; autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);

  function wrap(before: string, after = before, fallback = 'text') {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e } = el;
    const sel = value.slice(s, e) || fallback;
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    onChange(next);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(s + before.length, s + before.length + sel.length); });
  }

  function prefixLines(prefix: (i: number) => string) {
    const el = ref.current;
    if (!el) return;
    const s = value.lastIndexOf('\n', el.selectionStart - 1) + 1;
    const eIdx = value.indexOf('\n', el.selectionEnd);
    const e = eIdx === -1 ? value.length : eIdx;
    const block = value.slice(s, e).split('\n').map((l, i) => prefix(i) + l).join('\n');
    onChange(value.slice(0, s) + block + value.slice(e));
    requestAnimationFrame(() => el.focus());
  }

  const tools = [
    { label: 'Bold', icon: Bold, run: () => wrap('**') },
    { label: 'Italic', icon: Italic, run: () => wrap('*') },
    { label: 'Bulleted list', icon: List, run: () => prefixLines(() => '- ') },
    { label: 'Numbered list', icon: ListOrdered, run: () => prefixLines((i) => `${i + 1}. `) },
    { label: 'Link', icon: Link2, run: () => wrap('[', '](https://)', 'link text') },
    { label: 'Code', icon: Code, run: () => wrap('`') },
  ];

  return (
    <div className="rounded-lg border border-gray-300 focus-within:border-primary-500 focus-within:ring-2 focus-within:ring-primary-500">
      <div className="flex items-center gap-0.5 border-b border-gray-100 px-1.5 py-1">
        {tools.map((t) => (
          <button key={t.label} type="button" title={t.label} aria-label={t.label} disabled={preview} onClick={t.run}
            className="rounded p-1.5 text-gray-500 hover:bg-gray-100 hover:text-gray-800 disabled:opacity-40">
            <t.icon className="h-4 w-4" />
          </button>
        ))}
        <button type="button" onClick={() => setPreview((p) => !p)}
          className="ml-auto inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100 hover:text-gray-800">
          {preview ? <><Pencil className="h-3.5 w-3.5" />Write</> : <><Eye className="h-3.5 w-3.5" />Preview</>}
        </button>
      </div>
      {preview ? (
        <div className="min-h-[6rem] px-3 py-2 text-sm">
          {value.trim() ? <Markdown source={value} /> : <p className="text-gray-400">Nothing to preview.</p>}
        </div>
      ) : (
        <textarea ref={ref} id={id} rows={rows} value={value} placeholder={placeholder} autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'b') { e.preventDefault(); wrap('**'); }
            if ((e.metaKey || e.ctrlKey) && e.key === 'i') { e.preventDefault(); wrap('*'); }
          }}
          className={cn(inputCls, 'resize-y border-0 focus:ring-0')} />
      )}
    </div>
  );
}
