/** Parsing and validating ticket fields from request bodies. */
import { queryOne } from '@/lib/db';
import { HttpError } from '@/lib/training/http';
import { isPriority, isType } from './rules';

export function str(v: unknown, field: string, max: number, required = false): string | undefined {
  if (v === undefined) {
    if (required) throw new HttpError(400, `${field} is required`);
    return undefined;
  }
  const s = String(v ?? '').trim();
  if (required && !s) throw new HttpError(400, `${field} is required`);
  if (s.length > max) throw new HttpError(400, `${field} must be ${max} characters or fewer`);
  return s;
}

export function dateOrNull(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const s = String(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) throw new HttpError(400, `${field} must be a date (YYYY-MM-DD)`);
  return s;
}

export function hoursOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 9999) throw new HttpError(400, 'Estimate must be between 0 and 9999 hours');
  return Math.round(n * 100) / 100;
}

export function typeOf(v: unknown, fallback?: string) {
  if (v === undefined && fallback) return fallback;
  if (!isType(v)) throw new HttpError(400, 'Unknown ticket type');
  return v;
}

export function priorityOf(v: unknown, fallback?: string) {
  if (v === undefined && fallback) return fallback as any;
  if (!isPriority(v)) throw new HttpError(400, 'Priority must be urgent, high, normal or low');
  return v;
}

export async function epicInProject(epicId: unknown, projectId: number): Promise<number | null | undefined> {
  if (epicId === undefined) return undefined;
  if (epicId === null || epicId === '') return null;
  const e = await queryOne(`SELECT id FROM epics WHERE id = $1 AND project_id = $2`, [Number(epicId), projectId]);
  if (!e) throw new HttpError(400, 'That epic is not in this project');
  return Number(epicId);
}

/** Subtasks are one level deep and stay in their parent's project. */
export async function parentInProject(parentId: unknown, projectId: number, selfId?: number): Promise<number | null | undefined> {
  if (parentId === undefined) return undefined;
  if (parentId === null || parentId === '') return null;
  const id = Number(parentId);
  if (selfId && id === selfId) throw new HttpError(400, 'A ticket cannot be its own parent');
  const p = await queryOne<{ parent_id: number | null }>(
    `SELECT parent_id FROM tickets WHERE id = $1 AND project_id = $2 AND deleted_at IS NULL`, [id, projectId]
  );
  if (!p) throw new HttpError(400, 'Parent ticket is not in this project');
  if (p.parent_id) throw new HttpError(400, 'Subtasks can’t have their own subtasks');
  if (selfId) {
    const kids = await queryOne(`SELECT 1 FROM tickets WHERE parent_id = $1 AND deleted_at IS NULL LIMIT 1`, [selfId]);
    if (kids) throw new HttpError(400, 'This ticket has subtasks, so it can’t become a subtask');
  }
  return id;
}

/** Only the project's developers can be assigned. */
export async function projectDevIds(projectId: number, ids: unknown): Promise<number[]> {
  if (!Array.isArray(ids)) throw new HttpError(400, 'user_ids must be a list');
  const want = Array.from(new Set(ids.map(Number).filter(Number.isFinite)));
  if (!want.length) return [];
  const { query } = await import('@/lib/db');
  const ok = await query<{ user_id: string }>(
    `SELECT m.user_id FROM project_members m JOIN users u ON u.id = m.user_id
      WHERE m.project_id = $1 AND m.user_id = ANY($2::bigint[]) AND m.member_role IN ('developer', 'lead_developer')
        AND u.role = 'developer' AND COALESCE(u.is_active, true)`,
    [projectId, want]
  );
  if (ok.length !== want.length) throw new HttpError(400, 'Only developers on this project can be assigned');
  return want;
}
