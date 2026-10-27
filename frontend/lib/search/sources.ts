/**
 * Global search = a list of sources, each searching one kind of thing.
 *
 * Adding a source (docs, snippets, chat channels, brief entries…):
 *   1. give the table a `search tsvector GENERATED … STORED` column + GIN index
 *   2. registerSearchSource({ kind, label, ticketFilters?, run }) below or from your module
 *   3. in run(), JOIN projects p and filter with `${visibility}` (built from
 *      visibilityClause, uses $1 = viewer id) — NEVER return rows the viewer can't see.
 *      Sources not tied to a project must apply their own access rule.
 *
 * Order of registration = order of groups in the results.
 */
import { query } from '@/lib/db';
import { Viewer, visibilityClause } from '@/lib/projects/core';
import { ParsedSearch } from './query';
import { viewHref, viewVisibilitySql } from '@/lib/saved-views';

export interface SearchHit {
  kind: string;
  id: string;
  title: string;
  subtitle?: string;
  snippet?: string;
  href: string;
  project_id?: number | null;
}

export interface SearchContext {
  viewer: Viewer;
  q: ParsedSearch;
  limit: number;
  /** SQL for "viewer may see project p" using $1 = viewer id. */
  visibility: string;
}

export interface SearchSource {
  kind: string;
  label: string;
  /** True if this source understands ticket filters (status:, assignee:, …). Others are skipped when they're used. */
  ticketFilters?: boolean;
  run(ctx: SearchContext): Promise<SearchHit[]>;
}

const sources: SearchSource[] = [];

export function registerSearchSource(s: SearchSource) {
  const i = sources.findIndex((x) => x.kind === s.kind);
  if (i >= 0) sources[i] = s; else sources.push(s);
}

export function searchSources(): readonly SearchSource[] {
  return sources;
}

/**
 * Text condition: full-text match on a tsvector column, or every word appearing
 * somewhere in the plain columns ("header mockup" finds header-mockup.png).
 * $param = to_tsquery string, $param+1 = text[] of words.
 */
function textCond(col: string, likeCols: string[], param: number) {
  const hay = `concat_ws(' ', ${likeCols.join(', ')})`;
  return `(${col} @@ to_tsquery('simple', $${param})
    OR NOT EXISTS (SELECT 1 FROM unnest($${param + 1}::text[]) w WHERE ${hay} NOT ILIKE '%' || w || '%'))`;
}

export function searchWords(text: string): string[] {
  return text.toLowerCase().split(/\s+/).map((w) => w.replace(/[%_\\]/g, '')).filter(Boolean).slice(0, 8);
}

/** "booking butt" → "booking & butt:*" (safe: only letters/digits survive). */
export function prefixQuery(text: string): string | null {
  // Letters (Latin incl. accents, Arabic/Urdu) and digits only, so nothing can break to_tsquery.
  const words = text.toLowerCase().split(/[^a-z0-9\u00c0-\u024f\u0600-\u06ff]+/).filter(Boolean);
  if (!words.length) return null;
  return words.slice(0, 8).map((w, i, a) => (i === a.length - 1 ? `${w}:*` : w)).join(' & ');
}

const snip = (s: string | null | undefined, text: string) => {
  if (!s) return undefined;
  const flat = s.replace(/\s+/g, ' ');
  const i = text ? flat.toLowerCase().indexOf(text.toLowerCase().split(' ')[0]) : -1;
  const start = Math.max(0, i - 40);
  return (start ? '…' : '') + flat.slice(start, start + 140) + (flat.length > start + 140 ? '…' : '');
};

// ------------------------------------------------------------------ tickets

registerSearchSource({
  kind: 'ticket', label: 'Tickets', ticketFilters: true,
  async run({ viewer, q, limit, visibility }) {
    const where = ['t.deleted_at IS NULL', visibility];
    const args: unknown[] = [viewer.userId];
    const add = (sql: string, ...vals: unknown[]) => {
      let s = sql;
      for (const v of vals) { args.push(v); s = s.replace('?', `$${args.length}`); }
      where.push(s);
    };
    if (q.text) {
      const pq = prefixQuery(q.text);
      if (q.key) { args.push(q.key); where.push(`t.key = $${args.length}`); }
      else if (pq) { args.push(pq, searchWords(q.text)); where.push(textCond('t.search', ['t.title', 't.key'], args.length - 1)); }
    }
    if (q.project) add('p.ticket_no = ?', q.project);
    if (q.status) add('t.status = ANY(?::text[])', q.status);
    else if (q.open) where.push(`t.status NOT IN ('done','closed','declined')`);
    if (q.type) add('t.type = ?', q.type);
    if (q.priority) add('t.priority = ?', q.priority);
    if (q.due) add(`t.due_date ${q.due.op} ?::date`, q.due.date);
    if (q.assignee === 'me' || q.mine) add('EXISTS (SELECT 1 FROM ticket_assignees a WHERE a.ticket_id = t.id AND a.user_id = ?)', viewer.userId);
    else if (q.assignee) add('EXISTS (SELECT 1 FROM ticket_assignees a JOIN users u ON u.id = a.user_id WHERE a.ticket_id = t.id AND LOWER(u.username) = ?)', q.assignee);
    if (q.blocked) where.push(`EXISTS (SELECT 1 FROM ticket_relations r JOIN tickets b ON b.id = r.from_ticket_id
      WHERE r.to_ticket_id = t.id AND r.kind = 'blocks' AND b.deleted_at IS NULL AND b.status NOT IN ('done','closed','declined'))`);
    args.push(limit);
    const rows = await query<{ id: number; key: string; title: string; status: string; project_id: number; ticket_no: string; client_name: string; description: string }>(
      `SELECT t.id, t.key, t.title, t.status, t.project_id, p.ticket_no, p.client_name, t.description
         FROM tickets t JOIN projects p ON p.id = t.project_id
        WHERE ${where.join(' AND ')}
        ORDER BY (t.status IN ('done','closed','declined')), t.updated_at DESC
        LIMIT $${args.length}`,
      args
    );
    return rows.map((r) => ({
      kind: 'ticket', id: r.key, title: `${r.key} ${r.title}`, subtitle: `${r.ticket_no} · ${r.client_name} · ${r.status.replace(/_/g, ' ')}`,
      snippet: q.text ? snip(r.description, q.text) : undefined, href: `/projects/${r.project_id}/tickets/${r.key}`, project_id: r.project_id,
    }));
  },
});

// ------------------------------------------------------------------ projects

registerSearchSource({
  kind: 'project', label: 'Projects',
  async run({ viewer, q, limit, visibility }) {
    const pq = q.text ? prefixQuery(q.text) : null;
    if (!pq && !q.project) return [];
    const args: unknown[] = [viewer.userId];
    const where = [visibility];
    if (pq) { args.push(pq, searchWords(q.text)); where.push(textCond('p.search', ['p.title', 'p.client_name', 'p.client_company', 'p.ticket_no'], args.length - 1)); }
    if (q.project) { args.push(q.project); where.push(`p.ticket_no = $${args.length}`); }
    args.push(limit);
    const rows = await query<{ id: number; ticket_no: string; title: string; client_name: string; client_company: string | null; status: string }>(
      `SELECT p.id, p.ticket_no, p.title, p.client_name, p.client_company, p.status FROM projects p
        WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT $${args.length}`,
      args
    );
    return rows.map((r) => ({
      kind: 'project', id: String(r.id), title: `${r.ticket_no} ${r.title}`,
      subtitle: `${r.client_name}${r.client_company ? ` · ${r.client_company}` : ''} · ${r.status.replace(/_/g, ' ')}`,
      href: `/projects/${r.id}`, project_id: r.id,
    }));
  },
});

// ------------------------------------------------------------------ ticket comments

registerSearchSource({
  kind: 'comment', label: 'Comments',
  async run({ viewer, q, limit, visibility }) {
    const pq = q.text ? prefixQuery(q.text) : null;
    if (!pq) return [];
    const args: unknown[] = [viewer.userId, pq, searchWords(q.text)];
    const where = [visibility, 'c.deleted_at IS NULL', 't.deleted_at IS NULL', textCond('c.search', ['c.body'], 2)];
    if (q.project) { args.push(q.project); where.push(`p.ticket_no = $${args.length}`); }
    args.push(limit);
    const rows = await query<{ id: number; body: string; key: string; project_id: number; user_name: string | null; title: string }>(
      `SELECT c.id, c.body, t.key, t.title, t.project_id, u.full_name AS user_name
         FROM ticket_comments c JOIN tickets t ON t.id = c.ticket_id JOIN projects p ON p.id = t.project_id
         LEFT JOIN users u ON u.id = c.user_id
        WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT $${args.length}`,
      args
    );
    return rows.map((r) => ({
      kind: 'comment', id: String(r.id), title: `${r.user_name || 'Someone'} on ${r.key}`, subtitle: r.title,
      snippet: snip(r.body, q.text), href: `/projects/${r.project_id}/tickets/${r.key}`, project_id: r.project_id,
    }));
  },
});

// ------------------------------------------------------------------ files

registerSearchSource({
  kind: 'file', label: 'Files',
  async run({ viewer, q, limit, visibility }) {
    const pq = q.text ? prefixQuery(q.text) : null;
    if (!pq) return [];
    const args: unknown[] = [viewer.userId, pq, searchWords(q.text)];
    const where = [visibility, 'm.deleted_at IS NULL', `m.status = 'ready'`, textCond('m.search', ['m.file_name', 'm.description'], 2)];
    if (q.project) { args.push(q.project); where.push(`p.ticket_no = $${args.length}`); }
    args.push(limit);
    const rows = await query<{ id: string; file_name: string; description: string | null; project_id: number; ticket_no: string; ticket_key: string | null }>(
      `SELECT m.id, m.file_name, m.description, m.project_id, p.ticket_no,
              CASE WHEN m.entity_type = 'ticket' THEN (SELECT key FROM tickets WHERE id = m.entity_id::int) END AS ticket_key
         FROM media_files m JOIN projects p ON p.id = m.project_id
        WHERE ${where.join(' AND ')} ORDER BY m.created_at DESC LIMIT $${args.length}`,
      args
    );
    return rows.map((r) => ({
      kind: 'file', id: r.id, title: r.file_name, subtitle: `${r.ticket_key || r.ticket_no}${r.description ? ` · ${r.description}` : ''}`,
      href: r.ticket_key ? `/projects/${r.project_id}/tickets/${r.ticket_key}` : `/projects/${r.project_id}?tab=files`, project_id: r.project_id,
    }));
  },
});

// ------------------------------------------------------------------ project thread messages

registerSearchSource({
  kind: 'message', label: 'Messages',
  async run({ viewer, q, limit, visibility }) {
    const pq = q.text ? prefixQuery(q.text) : null;
    if (!pq) return [];
    const args: unknown[] = [viewer.userId, pq, searchWords(q.text)];
    const where = [visibility, `pm.kind IN ('message', 'media')`, 'pm.deleted_at IS NULL', 'NOT pm.is_draft', textCond('pm.search', ['pm.body'], 2)];
    if (q.project) { args.push(q.project); where.push(`p.ticket_no = $${args.length}`); }
    args.push(limit);
    const rows = await query<{ id: number; body: string; project_id: number; ticket_no: string; user_name: string | null }>(
      `SELECT pm.id, pm.body, pm.project_id, p.ticket_no, u.full_name AS user_name
         FROM project_messages pm JOIN projects p ON p.id = pm.project_id LEFT JOIN users u ON u.id = pm.user_id
        WHERE ${where.join(' AND ')} ORDER BY pm.created_at DESC LIMIT $${args.length}`,
      args
    );
    return rows.map((r) => ({
      kind: 'message', id: String(r.id), title: `${r.user_name || 'Someone'} in ${r.ticket_no}`, snippet: snip(r.body, q.text),
      href: `/projects/${r.project_id}?tab=thread#m-${r.id}`, project_id: r.project_id,
    }));
  },
});

// ------------------------------------------------------------------ brief timeline (Phase 3)

registerSearchSource({
  kind: 'brief', label: 'Brief updates',
  async run({ viewer, q, limit, visibility }) {
    const pq = q.text ? prefixQuery(q.text) : null;
    if (!pq) return [];
    const args: unknown[] = [viewer.userId, pq, searchWords(q.text)];
    const where = [visibility, 'e.deleted_at IS NULL', textCond('e.search', ['e.body'], 2)];
    if (q.project) { args.push(q.project); where.push(`p.ticket_no = $${args.length}`); }
    args.push(limit);
    const rows = await query<{ id: number; body: string; type: string; project_id: number; ticket_no: string; is_original: boolean }>(
      `SELECT e.id, e.body, e.type, e.project_id, p.ticket_no, e.is_original
         FROM brief_entries e JOIN projects p ON p.id = e.project_id
        WHERE ${where.join(' AND ')} ORDER BY e.created_at DESC LIMIT $${args.length}`,
      args
    );
    return rows.map((r) => ({
      kind: 'brief', id: String(r.id), title: `${r.is_original ? 'Original brief' : 'Brief update'} · ${r.ticket_no}`, snippet: snip(r.body, q.text),
      href: `/projects/${r.project_id}?tab=brief#brief-${r.id}`, project_id: r.project_id,
    }));
  },
});

// ------------------------------------------------------------------ saved views (Phase 2)

registerSearchSource({
  kind: 'view', label: 'Saved views',
  async run({ viewer, q, limit, visibility }) {
    const pq = q.text ? prefixQuery(q.text) : null;
    if (!pq) return [];
    // $1 = viewer id (shared with `visibility`), $2 = role, then the text params.
    const args: unknown[] = [viewer.userId, viewer.role, pq, searchWords(q.text), limit];
    const rows = await query<{ id: number; name: string; view_type: string; project_id: number | null; ticket_no: string | null; scope: string }>(
      `SELECT sv.id, sv.name, sv.view_type, sv.project_id, p2.ticket_no, sv.scope
         FROM saved_views sv LEFT JOIN projects p2 ON p2.id = sv.project_id
        WHERE ${viewVisibilitySql(visibility)} AND ${textCond('sv.search', ['sv.name'], 3)}
        ORDER BY LOWER(sv.name) LIMIT $5`,
      args
    );
    return rows.map((r) => ({
      kind: 'view', id: String(r.id), title: r.name,
      subtitle: `${r.view_type.replace('_', ' ')} view${r.ticket_no ? ` · ${r.ticket_no}` : ''}${r.scope === 'shared' ? ' · shared' : ''}`,
      href: viewHref(r), project_id: r.project_id,
    }));
  },
});

// ------------------------------------------------------------------ reminders (Phase 5)
// Not tied to project visibility: only reminders for, or set by, the viewer.

registerSearchSource({
  kind: 'reminder', label: 'Reminders',
  async run({ viewer, q, limit }) {
    const pq = q.text ? prefixQuery(q.text) : null;
    if (!pq) return [];
    const rows = await query<{ id: number; title: string; note: string | null; due: string; ticket_no: string | null; status: string }>(
      `SELECT r.id, r.title, r.note, COALESCE(r.snoozed_until, r.due_at) AS due, p.ticket_no, r.status
         FROM reminders r LEFT JOIN projects p ON p.id = r.project_id
        WHERE (r.assigned_to = $1 OR r.created_by = $1) AND r.status = 'open' AND ${textCond('r.search', ['r.title', "coalesce(r.note, '')"], 2)}
        ORDER BY COALESCE(r.snoozed_until, r.due_at) LIMIT $4`,
      [viewer.userId, pq, searchWords(q.text), limit]
    );
    return rows.map((r) => ({
      kind: 'reminder', id: String(r.id), title: r.title,
      subtitle: `Due ${new Date(r.due).toISOString().slice(0, 16).replace('T', ' ')} UTC${r.ticket_no ? ` · ${r.ticket_no}` : ''}`,
      snippet: r.note ? snip(r.note, q.text) : undefined, href: `/my-tasks#reminder-${r.id}`,
    }));
  },
});

/** Run every applicable source with permission filtering. */
export async function runSearch(viewer: Viewer, q: ParsedSearch, limit = 8) {
  const visibility = visibilityClause(viewer, 'p');
  const groups = [];
  for (const s of sources) {
    if (q.ticketOnly && !s.ticketFilters) continue;
    if (!q.text && !q.ticketOnly && !q.project) continue;
    const hits = await s.run({ viewer, q, limit, visibility });
    if (hits.length) groups.push({ kind: s.kind, label: s.label, hits });
  }
  return groups;
}
