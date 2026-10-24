import { NextRequest, NextResponse } from 'next/server';
import { runTrainingTick } from '@/lib/training/scheduler';
import { generateCoachDigest } from '@/lib/training/digest';
import { advanceRampPhases } from '@/lib/training/ramp';
import { deliverOutbox } from '@/lib/training/events';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * GET/POST /api/cron/training (Bearer CRON_SECRET) — backup trigger for the
 * in-app training scheduler. ?job=tick|ramp|outbox|digest
 */
async function run(request: NextRequest) {
  const auth = request.headers.get('authorization');
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ status: 'error', message: 'Unauthorized' }, { status: 401 });
  }
  const job = new URL(request.url).searchParams.get('job') || 'tick';
  try {
    let result: unknown = null;
    if (job === 'ramp') result = { advanced: await advanceRampPhases() };
    else if (job === 'outbox') result = { delivered: await deliverOutbox(200) };
    else if (job === 'digest') result = await generateCoachDigest(true);
    else {
      await runTrainingTick();
      result = { ran: 'tick' };
    }
    return NextResponse.json({ status: 'success', job, result });
  } catch (err) {
    console.error('[cron/training]', err);
    return NextResponse.json({ status: 'error', message: (err as Error).message }, { status: 500 });
  }
}

export const GET = run;
export const POST = run;
