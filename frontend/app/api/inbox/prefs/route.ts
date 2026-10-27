import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, HttpError } from '@/lib/training/http';
import { getViewer } from '@/lib/projects/core';
import { emailConfigured } from '@/lib/email';
import { NOTIFICATION_TYPES } from '@/lib/notifications';

export const dynamic = 'force-dynamic';

/** GET /api/inbox/prefs — every type with your channel (in_app when unset), digest setting, whether email works. */
export const GET = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const rows = await query<{ type: string; channel: string }>(`SELECT type, channel FROM notification_prefs WHERE user_id = $1`, [v.userId]);
  const set = new Map(rows.map((r) => [r.type, r.channel]));
  const s = await queryOne<{ digest_enabled: boolean }>(`SELECT digest_enabled FROM notification_settings WHERE user_id = $1`, [v.userId]);
  const me = await queryOne<{ email_address: string | null }>(`SELECT email_address FROM users WHERE id = $1`, [v.userId]);
  return ok({
    types: NOTIFICATION_TYPES.map((t) => ({ ...t, channel: set.get(t.type) || 'in_app' })),
    digest_enabled: !!s?.digest_enabled,
    email_available: emailConfigured() && !!me?.email_address,
    has_email_address: !!me?.email_address,
  });
});

/** PUT /api/inbox/prefs { prefs?: { [type]: 'in_app'|'email'|'off' }, digest_enabled? } */
export const PUT = handler(async (request: NextRequest) => {
  const v = await getViewer(request);
  const b = await readJson(request);
  const known = new Set(NOTIFICATION_TYPES.map((t) => t.type));
  if (b.prefs && typeof b.prefs === 'object') {
    for (const [type, channel] of Object.entries(b.prefs)) {
      if (!known.has(type)) throw new HttpError(400, `Unknown notification type ${type}`);
      if (!['in_app', 'email', 'off'].includes(String(channel))) throw new HttpError(400, 'Channel must be in_app, email or off');
      if (channel === 'in_app') await query(`DELETE FROM notification_prefs WHERE user_id = $1 AND type = $2`, [v.userId, type]);
      else await query(
        `INSERT INTO notification_prefs (user_id, type, channel) VALUES ($1, $2, $3) ON CONFLICT (user_id, type) DO UPDATE SET channel = EXCLUDED.channel`,
        [v.userId, type, channel]
      );
    }
  }
  if (b.digest_enabled !== undefined) {
    await query(
      `INSERT INTO notification_settings (user_id, digest_enabled) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET digest_enabled = EXCLUDED.digest_enabled, updated_at = NOW()`,
      [v.userId, !!b.digest_enabled]
    );
  }
  return ok({ saved: true });
});
