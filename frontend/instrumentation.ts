/**
 * Next.js Instrumentation — runs once when the server starts.
 * Used to start the auto-distribution scheduler.
 */
export async function register() {
  // Only run on the server (not edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { checkAndAutoDistribute } = await import('@/lib/auto-distribute');

    // Check every 60 seconds if it's time to auto-distribute
    setInterval(async () => {
      await checkAndAutoDistribute();
    }, 60 * 1000);

    console.log('⏰ Auto-distribution scheduler started (checking every 60s)');
  }
}
