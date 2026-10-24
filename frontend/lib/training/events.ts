/**
 * Outbox pattern (B.9): the training module never edits payroll data. It records
 * events here; the in-app scheduler delivers them to registered webhooks, and the
 * salary system in this app reads training_ramp_history / v_rep_ramp_status.
 *
 * Event types: training.track_completed, training.certified,
 * training.ramp_phase_changed, training.supervised_flag
 */
import crypto from 'crypto';
import { query } from '@/lib/db';

export type TrainingEventType =
  | 'training.track_completed'
  | 'training.certified'
  | 'training.ramp_phase_changed'
  | 'training.supervised_flag';

export async function emitEvent(type: TrainingEventType, payload: Record<string, unknown>) {
  await query(
    `INSERT INTO training_events_outbox (type, payload_json) VALUES ($1, $2::jsonb)`,
    [type, JSON.stringify({ ...payload, emitted_at: new Date().toISOString() })]
  );
}

export async function notify(userId: number, type: string, body: string, link?: string) {
  await query(
    `INSERT INTO training_notifications (user_id, type, body, link) VALUES ($1, $2, $3, $4)`,
    [userId, type, body, link ?? null]
  );
}

/** Notify every active HR user (trainer). */
export async function notifyTrainers(type: string, body: string, link?: string) {
  await query(
    `INSERT INTO training_notifications (user_id, type, body, link)
     SELECT id, $1, $2, $3 FROM users WHERE role = 'hr' AND COALESCE(is_active, true)`,
    [type, body, link ?? null]
  );
}

const MAX_ATTEMPTS = 10;

/** Deliver pending outbox events to webhooks. Returns how many were delivered. */
export async function deliverOutbox(limit = 50): Promise<number> {
  const events = await query<{ id: number; type: string; payload_json: any; attempts: number }>(
    `SELECT id, type, payload_json, attempts FROM training_events_outbox
     WHERE delivered_at IS NULL AND attempts < $1
     ORDER BY created_at LIMIT $2`,
    [MAX_ATTEMPTS, limit]
  );
  if (events.length === 0) return 0;

  const hooks = await query<{ id: number; url: string; secret: string | null; event_types: string[] }>(
    `SELECT id, url, secret, event_types FROM training_webhooks WHERE active`
  );

  let delivered = 0;
  for (const ev of events) {
    const targets = hooks.filter((h) => !h.event_types?.length || h.event_types.includes(ev.type));
    const body = JSON.stringify({ id: ev.id, type: ev.type, payload: ev.payload_json });
    const errors: string[] = [];

    for (const hook of targets) {
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Training-Event': ev.type };
        if (hook.secret) {
          headers['X-Training-Signature'] =
            'sha256=' + crypto.createHmac('sha256', hook.secret).update(body).digest('hex');
        }
        const res = await fetch(hook.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(8000) });
        if (!res.ok) errors.push(`${hook.url}: HTTP ${res.status}`);
      } catch (err) {
        errors.push(`${hook.url}: ${(err as Error).message}`);
      }
    }

    if (errors.length === 0) {
      // No listeners is still "delivered": the in-app salary system reads the DB directly.
      await query(
        `UPDATE training_events_outbox SET delivered_at = CURRENT_TIMESTAMP, attempts = attempts + 1, last_error = NULL WHERE id = $1`,
        [ev.id]
      );
      delivered++;
    } else {
      await query(
        `UPDATE training_events_outbox SET attempts = attempts + 1, last_error = $2 WHERE id = $1`,
        [ev.id, errors.join('; ').slice(0, 1000)]
      );
    }
  }
  return delivered;
}
