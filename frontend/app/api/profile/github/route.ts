import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { github } from '@/lib/github/client';
import { syncRepoAccessSoon } from '@/lib/github/access';

export const dynamic = 'force-dynamic';

/** GET /api/profile/github — my linked account, if any. */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const link = await queryOne(`SELECT github_user_id, github_login, linked_at FROM developer_github WHERE user_id = $1`, [v.userId]);
  return ok({ link, oauth_configured: !!process.env.GITHUB_CLIENT_ID, app_configured: github().configured() });
});

/** DELETE /api/profile/github — unlink; repo access granted through it is removed. */
export const DELETE = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  await query(`DELETE FROM developer_github WHERE user_id = $1`, [v.userId]);
  const projects = await query<{ project_id: number }>(`SELECT project_id FROM repo_access WHERE user_id = $1`, [v.userId]);
  for (const p of projects) syncRepoAccessSoon(p.project_id);
  return ok({ unlinked: true });
});
