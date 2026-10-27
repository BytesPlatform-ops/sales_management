/**
 * Saved views: a filter/group/sort/columns combo someone named.
 *   personal → only the owner sees it
 *   shared   → everyone who can see its project; with no project, developers + HR
 * Only the owner or HR can change or delete one. Pure rules here; SQL mirrors them.
 */
import { ACTIVE_GRANT } from '@/lib/access/grant-sql';
export const VIEW_TYPES = ['board', 'list', 'backlog', 'calendar', 'my_work'] as const;
export type ViewType = (typeof VIEW_TYPES)[number];
export const isViewType = (v: unknown): v is ViewType => typeof v === 'string' && (VIEW_TYPES as readonly string[]).includes(v);

export interface ViewConfig {
  filters?: Record<string, string>;
  swimlane?: string;
  group_by?: string;
  sort?: { key: string; dir: 1 | -1 };
  columns?: string[];
}

const FILTER_KEYS = ['q', 'assignee', 'type', 'priority', 'epic', 'label', 'created_by', 'blocked', 'no_estimate', 'project_id', 'due'];
export const MAX_CONFIG_BYTES = 8 * 1024;

/** Keep only known keys with short string values; drop anything else. */
export function sanitizeViewConfig(raw: unknown): ViewConfig {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, any>;
  const out: ViewConfig = {};
  if (c.filters && typeof c.filters === 'object') {
    const f: Record<string, string> = {};
    for (const k of FILTER_KEYS) {
      const v = c.filters[k];
      if (v !== undefined && v !== null && v !== '' && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')) f[k] = String(v).slice(0, 200);
    }
    out.filters = f;
  }
  if (['none', 'assignee', 'epic', 'priority'].includes(c.swimlane)) out.swimlane = c.swimlane;
  if (typeof c.group_by === 'string' && /^[a-z_]{1,30}$/.test(c.group_by)) out.group_by = c.group_by;
  if (c.sort && typeof c.sort.key === 'string' && /^[a-z_]{1,30}$/.test(c.sort.key)) out.sort = { key: c.sort.key, dir: c.sort.dir === -1 ? -1 : 1 };
  if (Array.isArray(c.columns)) out.columns = c.columns.filter((x: unknown) => typeof x === 'string' && /^[a-z_]{1,30}$/.test(x as string)).slice(0, 30);
  return out;
}

export interface ViewRow { owner_id: number | string; scope: 'personal' | 'shared'; project_id: number | null }
export interface ViewViewer { userId: number; role: 'hr' | 'agent' | 'developer' }

/** canSeeProject = viewer may open the view's project (ignored when it has none). */
export function canSeeView(v: ViewViewer, view: ViewRow, canSeeProject: boolean): boolean {
  if (Number(view.owner_id) === v.userId) return true;
  if (view.scope !== 'shared') return false;
  if (view.project_id != null) return canSeeProject;
  return v.role === 'developer' || v.role === 'hr';
}

export const canEditView = (v: ViewViewer, view: ViewRow) => Number(view.owner_id) === v.userId || v.role === 'hr';

/** Where a saved view opens. */
export function viewHref(view: { id: number; project_id: number | null; view_type: string }): string {
  if (view.view_type === 'my_work' || view.project_id == null) return `/my-tasks?view=${view.id}`;
  return `/projects/${view.project_id}?tab=tickets&view=${view.id}`;
}

/** SQL: saved views ($alias) the viewer may see. Uses $1 = viewer id and $2 = viewer role; `projectVisible` is visibilityClause(viewer,'p'). */
export function viewVisibilitySql(projectVisible: string, alias = 'sv'): string {
  return `(${alias}.owner_id = $1 OR (${alias}.scope = 'shared' AND (
            (${alias}.project_id IS NOT NULL AND EXISTS (SELECT 1 FROM projects p WHERE p.id = ${alias}.project_id AND ${projectVisible}))
         OR (${alias}.project_id IS NULL AND $2::text IN ('developer', 'hr')
             AND NOT EXISTS (SELECT 1 FROM developer_profiles dp WHERE dp.user_id = $1 AND dp.is_guest))))
         OR EXISTS (SELECT 1 FROM access_grants g WHERE g.grantee_id = $1 AND g.resource_type = 'saved_view'
                     AND g.resource_id = ${alias}.id::text AND ${ACTIVE_GRANT('g')}))`;
}
