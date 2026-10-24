import { NextRequest } from 'next/server';
import crypto from 'crypto';
import { query, queryOne } from '@/lib/db';
import { handler, ok, readJson, requireHr, requireServiceOrHr, HttpError } from '@/lib/training/http';

export const dynamic = 'force-dynamic';

/** GET /api/training/integration/webhooks — listeners + recent outbox events. */
export const GET = handler(async (request: NextRequest) => {
  await requireHr(request);
  const [hooks, events] = await Promise.all([
    query(`SELECT id, url, event_types, active, created_at, (secret IS NOT NULL) AS signed FROM training_webhooks ORDER BY id`),
    query(`SELECT id, type, payload_json, created_at, delivered_at, attempts, last_error FROM training_events_outbox ORDER BY created_at DESC LIMIT 50`),
  ]);
  return ok({ webhooks: hooks, events });
});

/**
 * POST /api/training/integration/webhooks { url, event_types?: [] } — register a salary-system listener.
 * Returns the signing secret once; deliveries carry X-Training-Signature: sha256=HMAC(body).
 */
export const POST = handler(async (request: NextRequest) => {
  const auth = await requireServiceOrHr(request);
  const b = await readJson(request);
  let url: URL;
  try {
    url = new URL(String(b.url));
  } catch {
    throw new HttpError(400, 'A valid url is required');
  }
  if (!['https:', 'http:'].includes(url.protocol)) throw new HttpError(400, 'url must be http(s)');
  const secret = crypto.randomBytes(24).toString('hex');
  const row = await queryOne(
    `INSERT INTO training_webhooks (url, secret, event_types, created_by) VALUES ($1, $2, $3, $4) RETURNING id, url, event_types, active`,
    [url.toString(), secret, Array.isArray(b.event_types) ? b.event_types : [], 'userId' in auth ? auth.userId : null]
  );
  return ok({ ...row, secret });
});
