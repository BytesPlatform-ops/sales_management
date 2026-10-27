import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { verifySignature } from '@/lib/github/rules';
import { HANDLED_EVENTS } from '@/lib/github/process';

export const dynamic = 'force-dynamic';

/**
 * POST /api/github/webhook — GitHub App deliveries.
 * Verifies X-Hub-Signature-256, stores the raw payload once per X-GitHub-Delivery and
 * answers immediately; lib/github/process works through the queue in the background.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) return NextResponse.json({ status: 'error', message: 'GitHub webhook is not configured' }, { status: 503 });
  const raw = await request.text();
  if (!verifySignature(secret, raw, request.headers.get('x-hub-signature-256'))) {
    return NextResponse.json({ status: 'error', message: 'Bad signature' }, { status: 401 });
  }
  const delivery = request.headers.get('x-github-delivery');
  const event = request.headers.get('x-github-event') || '';
  if (!delivery) return NextResponse.json({ status: 'error', message: 'Missing delivery id' }, { status: 400 });
  let payload: any;
  try { payload = JSON.parse(raw); } catch { return NextResponse.json({ status: 'error', message: 'Bad JSON' }, { status: 400 }); }

  // Unhandled events (ping, issues…) are stored as 'ignored' for the record but never processed.
  const stored = await queryOne(
    `INSERT INTO github_events (delivery_id, event, action, repo_id, payload, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6) ON CONFLICT (delivery_id) DO NOTHING RETURNING delivery_id`,
    [delivery.slice(0, 80), event.slice(0, 40), payload?.action ? String(payload.action).slice(0, 40) : null,
      payload?.repository?.id ?? null, raw, HANDLED_EVENTS.includes(event) ? 'pending' : 'ignored']
  );
  return NextResponse.json({ status: 'success', data: { queued: !!stored, duplicate: !stored } }, { status: 202 });
}
