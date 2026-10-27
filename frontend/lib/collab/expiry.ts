/**
 * Hourly: grants whose time ran out are marked (expired_notified_at), the people
 * involved are told, help requests close, and the ticket history notes it.
 * Access itself already stopped at expires_at — every request checks the time.
 */
import { query } from '@/lib/db';
import { notify } from '@/lib/notifications';
import { syncRepoAccess } from '@/lib/github/access';

export async function expireGrants(): Promise<number> {
  const rows = await query<{ id: number; grantee_id: string; granted_by: string | null; resource_type: string; source: string; project_id: number | null }>(
    `UPDATE access_grants SET expired_notified_at = NOW()
      WHERE expires_at IS NOT NULL AND expires_at <= NOW() AND revoked_at IS NULL AND expired_notified_at IS NULL
      RETURNING id, grantee_id, granted_by, resource_type, source, project_id`
  );
  for (const g of rows) {
    if (g.source === 'help_request') {
      const h = await query<{ id: number; ticket_id: number; requested_by: string }>(
        `UPDATE help_requests SET status = 'expired', updated_at = NOW() WHERE grant_id = $1 AND status = 'accepted' RETURNING id, ticket_id, requested_by`, [g.id]
      );
      for (const r of h) {
        await query(`INSERT INTO ticket_history (ticket_id, user_id, field, old_value, new_value) VALUES ($1, NULL, 'help_expired', NULL, $2::jsonb)`,
          [r.ticket_id, JSON.stringify({ help_request_id: r.id, grant_id: g.id })]);
      }
    }
    // Expired help access also loses its repo read access.
    if (g.project_id && g.resource_type === 'project') await syncRepoAccess(g.project_id).catch((e) => console.error('[github] repo access', (e as Error).message));
    const who = [Number(g.grantee_id), ...(g.granted_by ? [Number(g.granted_by)] : [])];
    await notify({ users: who, actorId: null, type: 'access_expired',
      body: `Temporary access to a shared ${g.resource_type.replace('_', ' ')} has ended`, link: '/shared', projectId: g.project_id });
  }
  return rows.length;
}
