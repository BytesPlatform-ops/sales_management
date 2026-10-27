/**
 * Project activity feed + health.
 *
 * What counts as activity (moves projects.last_activity_at, keeps health green):
 *   GitHub pushes / branches / PRs / deploys, work updates, ticket status changes
 *   made by people, brief updates and (non-system) thread messages. The last two
 *   already stamp last_activity_at in lib/brief and lib/chat.
 * Only GitHub events, work updates and finished tickets write feed rows: the feed
 * is the plain-language "what happened" for agents and HR, not a log of chat.
 */
import { query, queryOne } from '@/lib/db';
import { notify } from '@/lib/notifications';
import { computeHealth, Health } from '@/lib/github/rules';

export interface ActivityInput {
  projectId: number;
  ticketId?: number | null;
  actorUserId?: number | null;
  githubLogin?: string | null;
  kind: string;
  summary: string;
  url?: string | null;
  occurredAt?: Date | string | null;
  source: 'github' | 'manual' | 'app';
  /** Makes the row idempotent (webhook redeliveries). */
  sourceId?: string | null;
}

/** Add a feed row (once per sourceId) and mark the project active. Returns false for a duplicate. */
export async function recordActivity(a: ActivityInput): Promise<boolean> {
  const row = await queryOne(
    `INSERT INTO project_activity (project_id, ticket_id, actor_user_id, github_login, kind, summary, url, occurred_at, source, source_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, COALESCE($8::timestamptz, NOW()), $9, $10)
     ON CONFLICT (source_id) DO NOTHING RETURNING id`,
    [a.projectId, a.ticketId ?? null, a.actorUserId ?? null, a.githubLogin ?? null, a.kind, a.summary.slice(0, 500),
      a.url ?? null, a.occurredAt ?? null, a.source, a.sourceId ?? null]
  );
  if (!row) return false;
  await touchProject(a.projectId);
  return true;
}

/** Mark a project active now and re-check its health. */
export async function touchProject(projectId: number) {
  await query(`UPDATE projects SET last_activity_at = NOW() WHERE id = $1`, [projectId]);
  await refreshHealth([projectId]);
}

interface HealthRow { id: number; ticket_no: string; title: string; status: string; health: Health; last_activity_at: string | null; created_at: string; deadline: string | null; supervisor_id: string | null }

/**
 * Recompute health for some (or all open) projects. When a project turns red,
 * its supervisor (or every HR user if it has none) is told — once per change.
 */
export async function refreshHealth(projectIds?: number[], now = new Date()): Promise<{ changed: number; turnedRed: number }> {
  const rows = await query<HealthRow>(
    `SELECT id, ticket_no, title, status, health, last_activity_at, created_at, deadline::text AS deadline, supervisor_id
       FROM projects ${projectIds ? 'WHERE id = ANY($1::int[])' : `WHERE status NOT IN ('closed', 'cancelled')`}`,
    projectIds ? [projectIds] : []
  );
  let changed = 0, turnedRed = 0;
  for (const p of rows) {
    const h = computeHealth(p, now);
    if (h === p.health) continue;
    // Only the request that actually flips the value notifies (two jobs can race).
    const flipped = await queryOne(
      `UPDATE projects SET health = $2, health_changed_at = NOW() WHERE id = $1 AND health = $3 RETURNING id`, [p.id, h, p.health]
    );
    if (!flipped) continue;
    changed++;
    if (h === 'red') {
      turnedRed++;
      const to = p.supervisor_id
        ? [Number(p.supervisor_id)]
        : (await query<{ id: string }>(`SELECT id FROM users WHERE role = 'hr' AND COALESCE(is_active, true)`)).map((u) => Number(u.id));
      await notify({
        users: to, actorId: null, type: 'project_red',
        body: `${p.ticket_no} ${p.title} turned red (no activity for 7+ days or past its deadline)`,
        link: `/projects/${p.id}`, projectId: p.id, entity: { type: 'project', id: p.id },
      });
    }
  }
  return { changed, turnedRed };
}
