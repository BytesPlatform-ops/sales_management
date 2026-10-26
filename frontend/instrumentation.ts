/**
 * Next.js Instrumentation — runs once when the server starts.
 * Used to start the auto-distribution scheduler and the training-module jobs.
 */
export async function register() {
  // Only run on the server (not edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkAndAutoDistribute } = await import('@/lib/auto-distribute');
    const { runTrainingTick } = await import('@/lib/training/scheduler');
    const { runProjectsTick } = await import('@/lib/projects/scheduler');

    // Check every 60 seconds if it's time to auto-distribute
    setInterval(async () => {
      try {
        await checkAndAutoDistribute();
      } finally {
        // Training: outbox → webhooks, ramp phases, badges, batches, coach digest
        await runTrainingTick();
        // Projects: open the next cycle of recurring projects (hourly)
        await runProjectsTick();
      }
    }, 60 * 1000);

    console.log('⏰ Auto-distribution scheduler started (checking every 60s)');
  }
}
