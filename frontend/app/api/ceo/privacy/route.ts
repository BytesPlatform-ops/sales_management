import { NextRequest } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson } from '@/lib/training/http';
import { ceoCanSeeDMs, chatVisibility, NOTICE_LEAD_HOURS, requireCeo } from '@/lib/auth/ceo';

export const dynamic = 'force-dynamic';

/** GET /api/ceo/privacy — the workplace chat visibility setting and whether it's in effect. */
export const GET = handler(async (request: NextRequest) => {
  await requireCeo(request);
  return ok({ workplace_chat_visibility: await chatVisibility(), in_effect: await ceoCanSeeDMs(), notice_lead_hours: NOTICE_LEAD_HOURS });
});

/**
 * PUT /api/ceo/privacy { workplace_chat_visibility: boolean } — Admin mode.
 * Turning it ON publishes a notice to all staff now; it takes effect NOTICE_LEAD_HOURS later.
 * Turning it OFF takes effect at once.
 */
export const PUT = handler(async (request: NextRequest) => {
  const a = await requireCeo(request);
  const b = await readJson(request);
  const want = !!b.workplace_chat_visibility;
  const cur = await chatVisibility();
  let value = cur;
  if (want && !cur.enabled) {
    const effective = new Date(Date.now() + NOTICE_LEAD_HOURS * 3600_000);
    const n = await queryOne<{ id: number }>(
      `INSERT INTO staff_notices (kind, title, body, published_by, effective_at) VALUES ('workplace_chat_visibility', $1, $2, $3, $4) RETURNING id`,
      ['Work chats are visible to management',
        `From ${effective.toUTCString()}, messages in work chats, including direct messages, can be viewed by the company's management (CEO). Please keep work chats professional.`,
        a.userId, effective]
    );
    value = { enabled: true, effective_at: effective.toISOString(), notice_id: n!.id };
  } else if (!want) {
    value = { enabled: false, effective_at: null, notice_id: null };
  }
  await query(
    `INSERT INTO org_settings (key, value, updated_by, updated_at) VALUES ('workplace_chat_visibility', $1::jsonb, $2, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
    [JSON.stringify(value), a.userId]
  );
  return ok({ workplace_chat_visibility: value, in_effect: await ceoCanSeeDMs() });
});
