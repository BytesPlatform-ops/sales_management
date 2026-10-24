/**
 * Training jobs, driven by the existing in-app scheduler (instrumentation.ts,
 * every 60 s). Each job records its last run in training_settings so a server
 * restart doesn't re-run it.
 *
 *   every minute  deliver outbox events to webhooks
 *   every 10 min  poll OpenAI batches
 *   daily (PKT)   advance ramp phases, evaluate badges, purge old audio,
 *                 submit the pitch pre-compute batch, flag low scorecard reps
 *   Monday (PKT)  coach digest
 */
import { query, queryOne } from '@/lib/db';
import { deliverOutbox, notifyTrainers } from './events';
import { advanceRampPhases } from './ramp';
import { evaluateBadges } from './badges';
import { purgeOldAudio } from './call-reviews';
import { submitPitchBatch, pollBatches } from './batch';
import { generateCoachDigest } from './digest';
import { getSettings } from './settings';
import { activeReps, liveScorecardAvg } from './analytics';
import { getRampStatus } from './ramp';

let running = false;
let lastBatchPoll = 0;

function pktNow() {
  const d = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' }));
  return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, hour: d.getHours(), dow: d.getDay() };
}

async function lastRun(job: string): Promise<string | null> {
  const r = await queryOne<{ value: any }>(`SELECT value FROM training_settings WHERE key = $1`, [`job:${job}`]);
  return r?.value ?? null;
}

async function markRun(job: string, value: string) {
  await query(
    `INSERT INTO training_settings (key, value, description) VALUES ($1, $2::jsonb, 'scheduler bookkeeping')
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [`job:${job}`, JSON.stringify(value)]
  );
}

async function installed(): Promise<boolean> {
  try {
    await queryOne(`SELECT 1 FROM training_settings LIMIT 1`);
    return true;
  } catch {
    return false;
  }
}

async function daily(today: string) {
  const s = await getSettings();
  const advanced = await advanceRampPhases();
  const purged = await purgeOldAudio(s.audio_retention_days);

  const reps = await activeReps();
  const lowReps: string[] = [];
  for (const rep of reps) {
    await evaluateBadges(rep.id).catch((e) => console.error('[training] badges', e));
    // B.5 recertification: 4-week rolling scorecard < threshold → prompt trainer.
    const live = await liveScorecardAvg(rep.id);
    const ramp = await getRampStatus(rep.id);
    if (live.avg !== null && live.n >= 3 && live.avg < s.supervised_threshold && !['SUPERVISED', 'TRAINING'].includes(ramp.phase)) {
      lowReps.push(`${rep.full_name} (${live.avg})`);
    }
  }
  if (lowReps.length) {
    await notifyTrainers('supervised_suggestion', `4-week scorecard average below ${s.supervised_threshold}: ${lowReps.join(', ')}. Consider setting SUPERVISED.`, '/hr/training');
  }

  const batchId = await submitPitchBatch().catch((e) => {
    console.error('[training] pitch batch', e);
    return null;
  });
  console.log(`🎓 Training daily job ${today}: ramp advanced ${advanced}, audio purged ${purged}, batch ${batchId || 'none'}`);
}

export async function runTrainingTick() {
  if (running) return;
  running = true;
  try {
    if (!(await installed())) return;
    await deliverOutbox();

    if (Date.now() - lastBatchPoll > 10 * 60_000) {
      lastBatchPoll = Date.now();
      await pollBatches().catch((e) => console.error('[training] batch poll', e));
    }

    const { date, hour, dow } = pktNow();
    // Daily work after 6 a.m. PKT, i.e. after the night shift ends.
    if (hour >= 6 && (await lastRun('daily')) !== date) {
      await markRun('daily', date);
      await daily(date);
    }
    if (dow === 1 && hour >= 7 && (await lastRun('digest')) !== date) {
      await markRun('digest', date);
      await generateCoachDigest();
    }
  } catch (err) {
    console.error('[training] scheduler tick failed', err);
  } finally {
    running = false;
  }
}
