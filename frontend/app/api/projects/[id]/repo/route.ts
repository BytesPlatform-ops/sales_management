import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer, loadProject, requireSupervisor, systemMessage } from '@/lib/projects/core';
import { github } from '@/lib/github/client';
import { repoName } from '@/lib/github/rules';
import { syncRepoAccess } from '@/lib/github/access';

export const dynamic = 'force-dynamic';
type Ctx = { params: { id: string } };

/** GET /api/projects/{id}/repo — the linked repo (if any), tracking settings and who has access. */
export const GET = handler(async (request: NextRequest, { params }: Ctx) => {
  const v = await getViewer(request);
  const p = await loadProject(Number(params.id), v);
  const repo = await queryOne(`SELECT github_repo_id, full_name, html_url, default_branch, linked_at FROM project_repos WHERE project_id = $1`, [p.id]);
  const access = repo && v.role === 'hr'
    ? await query(`SELECT a.user_id, u.full_name AS name, a.github_login, a.permission, a.granted_at FROM repo_access a LEFT JOIN users u ON u.id = a.user_id WHERE a.project_id = $1 ORDER BY u.full_name`, [p.id])
    : [];
  const extra = await queryOne<{ tracking_source: string; production_env_name: string; staging_url: string | null; ready_to_deliver_at: string | null }>(
    `SELECT tracking_source, production_env_name, staging_url, ready_to_deliver_at FROM projects WHERE id = $1`, [p.id]
  );
  return ok({ repo, access, ...extra, github_configured: github().configured(), suggested_name: repoName(p.ticket_no, p.client_company || p.client_name) });
});

/**
 * POST /api/projects/{id}/repo — HR.
 *   { action: 'create' }            new private repo PRJ-XXXX-<client> in the org, developers added
 *   { full_name: 'org/existing' }   link an existing repo (recurring clients reuse theirs)
 */
export const POST = handler(async (request: NextRequest, { params }: Ctx) => {
  const v = await getViewer(request);
  requireSupervisor(v);
  const p = await loadProject(Number(params.id), v);
  if (await queryOne(`SELECT 1 FROM project_repos WHERE project_id = $1`, [p.id])) throw new HttpError(409, 'This project already has a repo — unlink it first');
  if (!github().configured()) throw new HttpError(503, 'GitHub is not configured on the server');
  const b = await readJson(request);
  let repo;
  if (b.action === 'create') {
    repo = await github().createOrgRepo(repoName(p.ticket_no, p.client_company || p.client_name), `${p.ticket_no} · ${p.title}`.slice(0, 350));
  } else {
    const full = String(b.full_name || '').trim();
    if (!/^[\w.-]+\/[\w.-]+$/.test(full)) throw new HttpError(400, 'Use owner/repo, e.g. bytesplatform/PRJ-0012-acme');
    repo = await github().getRepo(full);
  }
  const taken = await queryOne<{ ticket_no: string }>(
    `SELECT p.ticket_no FROM project_repos r JOIN projects p ON p.id = r.project_id WHERE r.github_repo_id = $1`, [repo.id]
  );
  if (taken) throw new HttpError(409, `That repo is already linked to ${taken.ticket_no}`);
  await query(
    `INSERT INTO project_repos (project_id, github_repo_id, full_name, html_url, default_branch, created_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [p.id, repo.id, repo.full_name, repo.html_url, repo.default_branch, v.userId]
  );
  await query(`UPDATE projects SET tracking_source = 'github', updated_at = NOW() WHERE id = $1`, [p.id]);
  const access = await syncRepoAccess(p.id);
  await systemMessage(p.id, `${v.name} ${b.action === 'create' ? 'created' : 'linked'} the GitHub repo ${repo.full_name}. Work is now tracked from GitHub.`, v.userId);
  return ok({ repo, access });
});

/** DELETE /api/projects/{id}/repo — HR. Unlinks (the GitHub repo itself is left alone). */
export const DELETE = handler(async (request: NextRequest, { params }: Ctx) => {
  const v = await getViewer(request);
  requireSupervisor(v);
  const p = await loadProject(Number(params.id), v);
  const r = await queryOne<{ full_name: string }>(`DELETE FROM project_repos WHERE project_id = $1 RETURNING full_name`, [p.id]);
  if (!r) throw new HttpError(404, 'No repo linked');
  await query(`DELETE FROM repo_access WHERE project_id = $1`, [p.id]);
  await query(`UPDATE projects SET tracking_source = 'manual', updated_at = NOW() WHERE id = $1`, [p.id]);
  await systemMessage(p.id, `${v.name} unlinked the GitHub repo ${r.full_name}. Work updates are tracked by hand.`, v.userId);
  return ok({ unlinked: r.full_name });
});
