/**
 * Projects job for the in-app scheduler: open the next delivery cycle for
 * recurring projects once the current one has ended. Hourly; no-op until the
 * projects tables exist.
 */
import { rollRecurringCycles } from './core';

let lastRun = 0;

export async function runProjectsTick() {
  if (Date.now() - lastRun < 60 * 60 * 1000) return;
  lastRun = Date.now();
  try {
    const opened = await rollRecurringCycles();
    if (opened) console.log(`📁 Projects: opened ${opened} recurring cycle(s)`);
  } catch (err) {
    if (!/does not exist/.test(String((err as Error)?.message))) console.error('[projects] scheduler', err);
  }
}
