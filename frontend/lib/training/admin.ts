/**
 * Whitelisted CRUD for trainer-editable content ("content is data", B.1).
 * Only the columns listed here can be written; JSON columns are validated.
 */
import { query, queryOne } from '@/lib/db';
import { HttpError } from './http';
import { invalidateSettings } from './settings';

interface EntityDef {
  table: string;
  columns: Record<string, 'text' | 'int' | 'bool' | 'json' | 'text[]' | 'num'>;
  required: string[];
  orderBy: string;
  filter?: Record<string, string>; // query param → column
}

export const ENTITIES: Record<string, EntityDef> = {
  tracks: {
    table: 'training_tracks', orderBy: 'sort_order, id', required: ['code', 'title'],
    columns: { code: 'text', title: 'text', description: 'text', sort_order: 'int', is_placeholder: 'bool', cert_code: 'text' },
  },
  courses: {
    table: 'training_courses', orderBy: 'track_id, sort_order, id', required: ['track_id', 'code', 'title'],
    columns: { track_id: 'int', code: 'text', title: 'text', description: 'text', sort_order: 'int', required: 'bool', day_number: 'int' },
    filter: { track_id: 'track_id' },
  },
  questions: {
    table: 'training_quiz_questions', orderBy: 'lesson_id, id', required: ['type', 'prompt', 'answer_json'],
    columns: { lesson_id: 'int', type: 'text', prompt: 'text', options_json: 'json', answer_json: 'json', explanation: 'text', tags: 'text[]', active: 'bool' },
    filter: { lesson_id: 'lesson_id' },
  },
  flashcards: {
    table: 'training_flashcards', orderBy: 'deck_lesson_id, sort_order, id', required: ['deck_lesson_id', 'front', 'back'],
    columns: { deck_lesson_id: 'int', front: 'text', back: 'text', tags: 'text[]', sort_order: 'int' },
    filter: { deck_lesson_id: 'deck_lesson_id', lesson_id: 'deck_lesson_id' },
  },
  scenarios: {
    table: 'training_roleplay_scenarios', orderBy: 'code', required: ['code', 'title', 'persona_json', 'objective'],
    columns: {
      code: 'text', title: 'text', persona_json: 'json', objective: 'text', difficulty: 'int', objections_json: 'json',
      rubric_id: 'int', source_lead_id: 'int', script_json: 'json', exam_kind: 'text', pass_rule: 'text', active: 'bool',
    },
  },
  objections: {
    table: 'training_objections', orderBy: 'num', required: ['num', 'objection'],
    columns: { num: 'int', objection: 'text', why_they_say_it: 'text', principle: 'text', responses_json: 'json', quick_response: 'text', tags: 'text[]', active: 'bool' },
  },
  classification: {
    table: 'training_classification_items', orderBy: 'id', required: ['firm_name', 'narrative', 'correct_service', 'reason'],
    columns: {
      firm_name: 'text', narrative: 'text', city_state: 'text', website_url: 'text', scan_flags: 'json', scan_summary: 'text',
      gov_mix: 'text', correct_service: 'text', acceptable_services: 'text[]', reason: 'text', active: 'bool',
    },
  },
  gates: {
    table: 'training_gates', orderBy: 'code', required: ['code', 'target_type', 'target_ref', 'rule_json'],
    columns: { code: 'text', target_type: 'text', target_ref: 'text', rule_json: 'json', description: 'text', active: 'bool' },
  },
  rubrics: {
    table: 'training_rubrics', orderBy: 'code', required: ['code', 'name', 'criteria_json'],
    columns: { code: 'text', name: 'text', criteria_json: 'json', auto_fail_json: 'json', auto_fail_cap: 'int', pass_score: 'int', excellent_score: 'int' },
  },
  badges: {
    table: 'training_badges', orderBy: 'id', required: ['code', 'title'],
    columns: { code: 'text', title: 'text', description: 'text', icon: 'text', criteria_json: 'json' },
  },
};

export function entityDef(name: string): EntityDef {
  const def = ENTITIES[name];
  if (!def) throw new HttpError(404, `Unknown content type "${name}"`);
  return def;
}

function coerce(type: EntityDef['columns'][string], value: any) {
  if (value === undefined) return undefined;
  if (value === null || value === '') return type === 'text' ? (value === '' ? '' : null) : null;
  switch (type) {
    case 'int': {
      const n = Number(value);
      if (!Number.isInteger(n)) throw new HttpError(400, `Expected an integer, got "${value}"`);
      return n;
    }
    case 'num': return Number(value);
    case 'bool': return value === true || value === 'true' || value === 1;
    case 'json': {
      if (typeof value === 'string') {
        try { return JSON.stringify(JSON.parse(value)); } catch { throw new HttpError(400, 'Invalid JSON'); }
      }
      return JSON.stringify(value);
    }
    case 'text[]': return Array.isArray(value) ? value.map(String) : String(value).split(',').map((s) => s.trim()).filter(Boolean);
    default: return String(value);
  }
}

function writable(def: EntityDef, body: any) {
  const cols: string[] = [];
  const vals: any[] = [];
  for (const [col, type] of Object.entries(def.columns)) {
    if (!(col in body)) continue;
    cols.push(col);
    vals.push(coerce(type, body[col]));
  }
  return { cols, vals, casts: cols.map((c) => (def.columns[c] === 'json' ? '::jsonb' : '')) };
}

export async function listEntity(name: string, params: URLSearchParams) {
  const def = entityDef(name);
  const where: string[] = [];
  const vals: any[] = [];
  for (const [param, col] of Object.entries(def.filter || {})) {
    const v = params.get(param);
    if (v) {
      vals.push(Number(v));
      where.push(`${col} = $${vals.length}`);
    }
  }
  return query(`SELECT * FROM ${def.table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${def.orderBy}`, vals);
}

export async function createEntity(name: string, body: any) {
  const def = entityDef(name);
  for (const r of def.required) if (body[r] === undefined || body[r] === null || body[r] === '') throw new HttpError(400, `${r} is required`);
  const { cols, vals, casts } = writable(def, body);
  const row = await queryOne(
    `INSERT INTO ${def.table} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}${casts[i]}`).join(', ')}) RETURNING *`,
    vals
  );
  invalidateSettings();
  return row;
}

export async function updateEntity(name: string, id: number, body: any) {
  const def = entityDef(name);
  const { cols, vals, casts } = writable(def, body);
  if (cols.length === 0) throw new HttpError(400, 'Nothing to update');
  vals.push(id);
  const row = await queryOne(
    `UPDATE ${def.table} SET ${cols.map((c, i) => `${c} = $${i + 1}${casts[i]}`).join(', ')}
     ${def.table === 'training_rubrics' ? ', updated_at = NOW()' : ''} WHERE id = $${vals.length} RETURNING *`,
    vals
  );
  if (!row) throw new HttpError(404, 'Not found');
  return row;
}

export async function deleteEntity(name: string, id: number) {
  const def = entityDef(name);
  const rows = await query(`DELETE FROM ${def.table} WHERE id = $1 RETURNING id`, [id]);
  if (!rows.length) throw new HttpError(404, 'Not found');
  return { deleted: id };
}

/** Flashcard bulk import (B.8: "flashcard bulk import (CSV)"). Accepts front,back[,tags] rows. */
export function parseFlashcardCsv(csv: string): { front: string; back: string; tags: string[] }[] {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }

  const cleaned = rows.map((r) => r.map((c) => c.trim())).filter((r) => r.length >= 2 && r[0] && r[1]);
  if (cleaned.length && /^front$/i.test(cleaned[0][0]) && /^back$/i.test(cleaned[0][1])) cleaned.shift();
  return cleaned.map((r) => ({ front: r[0], back: r[1], tags: r[2] ? r[2].split(/[;|]/).map((t) => t.trim()).filter(Boolean) : [] }));
}
