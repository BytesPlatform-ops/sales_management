/**
 * GitHub webhook processing. The webhook route only verifies and stores each
 * delivery; this runs in the background (in-app scheduler, job lock), claims a
 * batch with FOR UPDATE SKIP LOCKED, and retries failures with backoff.
 *
 *   push              activity per push; ticket keys in branch/commits → In progress;
 *                     project New → In progress
 *   create (branch)   key in branch name → In progress
 *   pull_request      opened/ready → In review (project In progress → In review);
 *                     closed+merged → Done (+ unblock notices)
 *   deployment_status success on the production environment → "Ready to deliver" to HR;
 *                     staging-like → projects.staging_url + "Deployed to staging"
 */
import { pool, query, queryOne } from '@/lib/db';
import { notify } from '@/lib/notifications';
import { systemMessage, STATUS_LABELS as PROJECT_STATUS_LABELS } from '@/lib/projects/core';
import { notify as ticketNotify, notifyUnblocked, ticketLink, watcherIds, TICKET_COLS, TicketRow } from '@/lib/tickets/core';
import { STATUS_LABELS } from '@/lib/tickets/rules';
import { recordActivity } from '@/lib/activity';
import {
  isProductionEnv, isStagingEnv, projectAutoMove, projectFrozen, ProjectSignal, ticketAutoMove, ticketKeysFor, TicketSignal,
} from './rules';

export const HANDLED_EVENTS = ['push', 'create', 'pull_request', 'deployment_status'];
export const MAX_ATTEMPTS = 6;

interface EventRow { delivery_id: string; event: string; action: string | null; repo_id: string | null; payload: any; attempts: number }

interface ProjectRef { id: number; ticket_no: string; title: string; status: string; supervisor_id: string | null; production_env_name: string; created_by: string }

// ------------------------------------------------------------------ queue

/** Process up to `limit` due deliveries. Safe to run on several instances at once. */
export async function runGithubQueue(limit = 25): Promise<{ done: number; failed: number; ignored: number }> {
  const stats = { done: 0, failed: 0, ignored: 0 };
  for (let i = 0; i < limit; i++) {
    const client = await pool.connect();
    let row: EventRow | undefined;
    try {
      await client.query('BEGIN');
      ({ rows: [row] } = await client.query<EventRow>(
        `SELECT delivery_id, event, action, repo_id, payload, attempts FROM github_events
          WHERE status = 'pending' AND next_attempt_at <= NOW()
          ORDER BY received_at LIMIT 1 FOR UPDATE SKIP LOCKED`
      ));
      if (!row) { await client.query('COMMIT'); break; }
      // Push the row out of reach while we work on it (outside this transaction).
      await client.query(`UPDATE github_events SET attempts = attempts + 1, next_attempt_at = NOW() + INTERVAL '10 minutes' WHERE delivery_id = $1`, [row.delivery_id]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }

    try {
      const outcome = await processEvent(row);
      await query(`UPDATE github_events SET status = $2, processed_at = NOW(), error = NULL WHERE delivery_id = $1`, [row.delivery_id, outcome]);
      outcome === 'ignored' ? stats.ignored++ : stats.done++;
    } catch (e) {
      const attempts = row.attempts + 1;
      const failed = attempts >= MAX_ATTEMPTS;
      // Backoff: 1, 2, 4, 8, 16 minutes.
      await query(
        `UPDATE github_events SET status = $2, error = $3, next_attempt_at = NOW() + ($4::int * INTERVAL '1 minute') WHERE delivery_id = $1`,
        [row.delivery_id, failed ? 'failed' : 'pending', String((e as Error)?.message || e).slice(0, 2000), 2 ** (attempts - 1)]
      );
      if (failed) stats.failed++;
      console.error('[github] event', row.delivery_id, (e as Error)?.message);
    }
  }
  return stats;
}

// ------------------------------------------------------------------ one event

export async function processEvent(e: Pick<EventRow, 'delivery_id' | 'event' | 'action' | 'payload'>): Promise<'done' | 'ignored'> {
  if (!HANDLED_EVENTS.includes(e.event)) return 'ignored';
  const p = e.payload || {};
  const repoId = p.repository?.id;
  if (!repoId) return 'ignored';
  const project = await queryOne<ProjectRef>(
    `SELECT p.id, p.ticket_no, p.title, p.status, p.supervisor_id, p.production_env_name, p.created_by
       FROM project_repos r JOIN projects p ON p.id = r.project_id WHERE r.github_repo_id = $1`, [repoId]
  );
  if (!project) return 'ignored';
  const actor = await actorFor(p.sender);
  const ctx: Ctx = { e, project, actor, frozen: projectFrozen(project.status) };

  switch (e.event) {
    case 'push': return onPush(ctx, p);
    case 'create': return onCreate(ctx, p);
    case 'pull_request': return onPullRequest(ctx, p);
    case 'deployment_status': return onDeployment(ctx, p);
  }
  return 'ignored';
}

interface Actor { userId: number | null; name: string; login: string | null }
interface Ctx { e: Pick<EventRow, 'delivery_id' | 'event' | 'action' | 'payload'>; project: ProjectRef; actor: Actor; frozen: boolean }

/** GitHub sender → our developer (linked account first, then login), else their login. */
async function actorFor(sender: any): Promise<Actor> {
  const login = sender?.login ? String(sender.login) : null;
  const u = await queryOne<{ id: string; full_name: string }>(
    `SELECT u.id, u.full_name FROM developer_github g JOIN users u ON u.id = g.user_id
      WHERE g.github_user_id = $1 OR LOWER(g.github_login) = LOWER($2) ORDER BY (g.github_user_id = $1) DESC LIMIT 1`,
    [Number(sender?.id) || 0, login || '']
  );
  return u ? { userId: Number(u.id), name: u.full_name, login } : { userId: null, name: login || 'Someone on GitHub', login };
}

const branchOf = (ref: string | undefined) => String(ref || '').replace(/^refs\/heads\//, '');
const short = (s: string, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const firstLine = (s: string) => String(s || '').split('\n')[0].trim();

async function ticketsFor(project: ProjectRef, keys: string[]): Promise<TicketRow[]> {
  if (!keys.length) return [];
  return query<TicketRow>(`SELECT ${TICKET_COLS} FROM tickets t WHERE t.project_id = $1 AND t.key = ANY($2::text[]) AND t.deleted_at IS NULL`, [project.id, keys]);
}

// ------------------------------------------------------------------ handlers

async function onPush(c: Ctx, p: any): Promise<'done' | 'ignored'> {
  if (p.deleted) return 'ignored';
  const branch = branchOf(p.ref);
  const commits: any[] = Array.isArray(p.commits) ? p.commits : [];
  const n = commits.length;
  const keys = ticketKeysFor(c.project.ticket_no, branch, ...commits.map((x) => x?.message));
  const tickets = await ticketsFor(c.project, keys);
  const what = n ? `${n} change${n === 1 ? '' : 's'}` : 'changes';
  const latest = commits.length ? firstLine(commits[commits.length - 1].message) : '';
  await recordActivity({
    projectId: c.project.id, ticketId: tickets.length === 1 ? tickets[0].id : null, actorUserId: c.actor.userId, githubLogin: c.actor.login,
    kind: 'push', summary: `${c.actor.name} saved ${what} on ${branch}${latest ? `: ${short(latest)}` : ''}`,
    url: p.compare || p.head_commit?.url || null, occurredAt: p.head_commit?.timestamp || null, source: 'github', sourceId: `${c.e.delivery_id}:push`,
  });
  await moveProject(c, 'push');
  for (const t of tickets) await moveTicket(c, t, keyIn(t.key, branch) ? 'branch' : 'commit');
  return 'done';
}

const keyIn = (key: string, text: string) => text.toUpperCase().includes(key);

async function onCreate(c: Ctx, p: any): Promise<'done' | 'ignored'> {
  if (p.ref_type !== 'branch') return 'ignored';
  const branch = String(p.ref || '');
  const tickets = await ticketsFor(c.project, ticketKeysFor(c.project.ticket_no, branch));
  await recordActivity({
    projectId: c.project.id, ticketId: tickets[0]?.id ?? null, actorUserId: c.actor.userId, githubLogin: c.actor.login,
    kind: 'branch', summary: `${c.actor.name} started work on ${tickets.length ? tickets.map((t) => `${t.key} (${short(t.title, 50)})`).join(', ') : branch}`,
    url: p.repository?.html_url ? `${p.repository.html_url}/tree/${encodeURIComponent(branch)}` : null, source: 'github', sourceId: `${c.e.delivery_id}:create`,
  });
  for (const t of tickets) await moveTicket(c, t, 'branch');
  return 'done';
}

async function onPullRequest(c: Ctx, p: any): Promise<'done' | 'ignored'> {
  const pr = p.pull_request || {};
  const action = String(p.action || '');
  const title = String(pr.title || '');
  const tickets = await ticketsFor(c.project, ticketKeysFor(c.project.ticket_no, title, pr.head?.ref, pr.body));
  const ticketId = tickets.length === 1 ? tickets[0].id : null;

  if ((action === 'opened' || action === 'reopened' || action === 'ready_for_review') && !pr.draft) {
    await recordActivity({
      projectId: c.project.id, ticketId, actorUserId: c.actor.userId, githubLogin: c.actor.login,
      kind: 'pr_opened', summary: `${c.actor.name} sent for review: ${short(title)}`, url: pr.html_url || null, source: 'github', sourceId: `${c.e.delivery_id}:pr`,
    });
    await moveProject(c, 'pr_opened');
    for (const t of tickets) await moveTicket(c, t, 'pr_opened');
    return 'done';
  }
  if (action === 'closed' && pr.merged) {
    await recordActivity({
      projectId: c.project.id, ticketId, actorUserId: c.actor.userId, githubLogin: c.actor.login,
      kind: 'pr_merged', summary: `${c.actor.name} merged: ${short(title)}`, url: pr.html_url || null,
      occurredAt: pr.merged_at || null, source: 'github', sourceId: `${c.e.delivery_id}:merged`,
    });
    for (const t of tickets) await moveTicket(c, t, 'pr_merged');
    return 'done';
  }
  return 'ignored';
}

async function onDeployment(c: Ctx, p: any): Promise<'done' | 'ignored'> {
  const ds = p.deployment_status || {};
  if (String(ds.state) !== 'success') return 'ignored';
  const env = String(ds.environment || p.deployment?.environment || '');
  const url = ds.environment_url || ds.target_url || null;
  const deploymentId = p.deployment?.id ?? ds.id;

  if (isProductionEnv(env, c.project.production_env_name)) {
    const first = await recordActivity({
      projectId: c.project.id, actorUserId: c.actor.userId, githubLogin: c.actor.login, kind: 'deploy_production',
      summary: `Deployed to production${url ? ` (${url})` : ''}`, url, source: 'github', sourceId: `deploy-prod:${c.project.id}:${deploymentId}`,
    });
    if (first) {
      // Never auto-deliver: tell the supervisor (or HR) it's ready, once per deployment.
      await query(`UPDATE projects SET ready_to_deliver_at = NOW() WHERE id = $1`, [c.project.id]);
      const to = c.project.supervisor_id ? [Number(c.project.supervisor_id)]
        : (await query<{ id: string }>(`SELECT id FROM users WHERE role = 'hr' AND COALESCE(is_active, true)`)).map((u) => Number(u.id));
      await notify({
        users: to, actorId: null, type: 'ready_to_deliver',
        body: `${c.project.ticket_no} ${c.project.title} was deployed to ${env}${url ? ` (${url})` : ''} — ready to deliver`,
        link: `/projects/${c.project.id}`, projectId: c.project.id, entity: { type: 'project', id: c.project.id },
      });
    }
    return 'done';
  }
  if (isStagingEnv(env)) {
    if (url && /^https?:\/\//i.test(url) && !c.frozen) await query(`UPDATE projects SET staging_url = $2, updated_at = NOW() WHERE id = $1`, [c.project.id, url]);
    await recordActivity({
      projectId: c.project.id, actorUserId: c.actor.userId, githubLogin: c.actor.login, kind: 'deploy_staging',
      summary: `Deployed to staging${url ? ` — preview: ${url}` : ''}`, url, source: 'github', sourceId: `deploy-stage:${c.project.id}:${deploymentId}`,
    });
    return 'done';
  }
  return 'ignored';
}

// ------------------------------------------------------------------ moves

async function moveProject(c: Ctx, signal: ProjectSignal) {
  if (c.frozen) return;
  const to = projectAutoMove(c.project.status, signal);
  if (!to) return;
  // Conditional update: if someone changed the status meanwhile, we don't override it.
  const moved = await queryOne(`UPDATE projects SET status = $2, updated_at = NOW() WHERE id = $1 AND status = $3 RETURNING id`, [c.project.id, to, c.project.status]);
  if (!moved) return;
  await systemMessage(c.project.id, `GitHub: project moved to ${PROJECT_STATUS_LABELS[to as keyof typeof PROJECT_STATUS_LABELS] || to} (${c.actor.name}).`);
  await notify({
    users: [Number(c.project.created_by)], actorId: null, type: 'project_status',
    body: `${c.project.ticket_no} ${c.project.title} is now ${PROJECT_STATUS_LABELS[to as keyof typeof PROJECT_STATUS_LABELS] || to}`,
    link: `/projects/${c.project.id}`, projectId: c.project.id,
  });
  c.project.status = to;
}

async function moveTicket(c: Ctx, t: TicketRow, signal: TicketSignal) {
  if (c.frozen) return;
  const crBlocked = t.type === 'change_request' && t.cr_status !== 'approved';
  const to = ticketAutoMove(t.status, signal, { crBlocked });
  if (!to) {
    // Idempotent by source_id: one note per ticket and signal.
    if (crBlocked && ticketAutoMove(t.status, signal)) {
      await recordActivity({
        projectId: c.project.id, ticketId: t.id, kind: 'cr_waiting', source: 'github', sourceId: `cr-wait:${t.id}:${signal}`,
        summary: `${t.key} has GitHub activity but is a change request waiting for HR approval — status not changed`,
      });
    }
    return;
  }
  const moved = await queryOne(
    `UPDATE tickets SET status = $2, done_at = COALESCE($4::timestamptz, done_at), updated_at = NOW() WHERE id = $1 AND status = $3 RETURNING id`,
    [t.id, to, t.status, to === 'done' ? new Date() : null]
  );
  if (!moved) return;
  await query(
    `INSERT INTO ticket_history (ticket_id, user_id, field, old_value, new_value, source) VALUES ($1, NULL, 'status', $2::jsonb, $3::jsonb, 'github')`,
    [t.id, JSON.stringify(t.status), JSON.stringify(to)]
  );
  const link = ticketLink(c.project.id, t.key);
  await ticketNotify(await watcherIds(t.id), null, 'ticket_status', `GitHub moved ${t.key} to ${STATUS_LABELS[to as keyof typeof STATUS_LABELS]} (${c.actor.name})`, link);
  if (to === 'done') {
    await ticketNotify([Number(t.created_by)], null, 'ticket_done', `${t.key} is done: ${t.title}`, link);
    await notifyUnblocked({ ...t, status: 'done' } as TicketRow, 0);
    await systemMessage(c.project.id, `${c.actor.name} finished ${t.key}: ${t.title} (merged on GitHub)`);
  }
  t.status = to as TicketRow['status'];
}
