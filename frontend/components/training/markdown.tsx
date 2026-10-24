'use client';

/**
 * Minimal, safe Markdown renderer for lesson bodies (trainer-authored content).
 * Builds React elements — never injects HTML. Supports headings, paragraphs,
 * bold/italic/code, links, ordered/unordered lists, tables, blockquotes,
 * fenced code blocks and horizontal rules.
 */
import { Fragment, ReactNode } from 'react';

function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  // order matters: code, bold, italic, link
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*|_[^_\s][^_]*_)|(\[[^\]]+\]\([^)\s]+\))/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const tok = m[0];
    const key = `${keyBase}-${i++}`;
    if (m[1]) out.push(<code key={key} className="px-1 py-0.5 rounded bg-gray-100 text-[0.9em] font-mono text-gray-800">{tok.slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={key} className="font-semibold text-gray-900">{inline(tok.slice(2, -2), key)}</strong>);
    else if (m[3]) out.push(<em key={key}>{inline(tok.slice(1, -1), key)}</em>);
    else if (m[4]) {
      const [, label, href] = tok.match(/\[([^\]]+)\]\(([^)]+)\)/) || [];
      const safe = /^(https?:|\/|#)/i.test(href) ? href : '#';
      out.push(<a key={key} href={safe} target={safe.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className="text-primary-600 underline underline-offset-2 hover:text-primary-700">{label}</a>);
    }
    last = m.index + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function isTableSep(line: string) {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}
function cells(line: string) {
  return line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

export function Markdown({ source, className = '' }: { source: string; className?: string }) {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;

  while (i < lines.length) {
    const line = lines[i];
    const key = `b${k++}`;

    if (/^```/.test(line)) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={key} className="my-4 overflow-x-auto rounded-lg bg-gray-900 text-gray-100 text-sm p-4 leading-relaxed"><code>{buf.join('\n')}</code></pre>);
      continue;
    }
    if (/^\s*$/.test(line)) { i++; continue; }
    if (/^(-{3,}|\*{3,})\s*$/.test(line)) { blocks.push(<hr key={key} className="my-6 border-gray-200" />); i++; continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const cls = ['text-2xl font-bold mt-2 mb-4', 'text-xl font-bold mt-8 mb-3', 'text-lg font-semibold mt-6 mb-2', 'text-base font-semibold mt-5 mb-2'][level - 1];
      const Tag = (`h${Math.min(level + 1, 6)}`) as keyof JSX.IntrinsicElements;
      blocks.push(<Tag key={key} className={`${cls} text-gray-900`}>{inline(h[2], key)}</Tag>);
      i++;
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
      blocks.push(
        <div key={key} className="my-4 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{head.map((c, j) => <th key={j} className="px-3 py-2 text-left font-semibold text-gray-700 border-b border-gray-200 align-bottom">{inline(c, `${key}h${j}`)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r, ri) => (
                <tr key={ri} className="align-top">{head.map((_, j) => <td key={j} className="px-3 py-2 text-gray-700">{inline(r[j] || '', `${key}r${ri}c${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, ''));
      blocks.push(
        <blockquote key={key} className="my-4 border-l-4 border-primary-300 bg-primary-50/60 rounded-r-lg px-4 py-3 text-gray-800">
          {buf.map((b, j) => (b.trim() ? <p key={j} className="my-1">{inline(b, `${key}q${j}`)}</p> : null))}
        </blockquote>
      );
      continue;
    }

    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: { text: string; indent: number }[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) {
        const indent = lines[i].match(/^\s*/)![0].length;
        let text = lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, '');
        i++;
        while (i < lines.length && /^\s{2,}\S/.test(lines[i]) && !/^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) text += ' ' + lines[i++].trim();
        items.push({ text, indent });
      }
      const ListTag = ordered ? 'ol' : 'ul';
      blocks.push(
        <ListTag key={key} className={`my-3 space-y-1.5 ${ordered ? 'list-decimal' : 'list-disc'} pl-6 text-gray-700 marker:text-gray-400`}>
          {items.map((it, j) => (
            <li key={j} className={it.indent >= 2 ? 'ml-5' : ''}>
              {it.text.match(/^\[( |x)\]\s/i)
                ? <span><span className="mr-1.5">{/^\[x\]/i.test(it.text) ? '☑' : '☐'}</span>{inline(it.text.slice(4), `${key}l${j}`)}</span>
                : inline(it.text, `${key}l${j}`)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i]) && !(lines[i].includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]))) {
      buf.push(lines[i++]);
    }
    blocks.push(<p key={key} className="my-3 leading-relaxed text-gray-700">{buf.map((b, j) => <Fragment key={j}>{j > 0 && ' '}{inline(b, `${key}p${j}`)}</Fragment>)}</p>);
  }

  return <div className={`max-w-none ${className}`}>{blocks}</div>;
}
