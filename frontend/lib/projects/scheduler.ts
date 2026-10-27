/**
 * Projects job for the in-app scheduler: open the next delivery cycle for
 * recurring projects once the current one has ended. instrumentation.ts runs it
 * at most hourly across all instances (job_locks); no-op until the projects
 * tables exist.
 */
import { rollRecurringCycles } from './core';

export async function runProjectsTick() {
  try {
    const opened = await rollRecurringCycles();
    if (opened) console.log(`📁 Projects: opened ${opened} recurring cycle(s)`);
  } catch (err) {
    if (!/does not exist/.test(String((err as Error)?.message))) console.error('[projects] scheduler', err);
  }
}
