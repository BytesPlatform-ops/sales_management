/**
 * Next.js Instrumentation — runs once when the server starts.
 * Used to start the auto-distribution scheduler and the training-module jobs.
 */
export async function register() {
  // Only run on the server (not edge runtime)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Refuse to start without a real JWT secret: every login token is signed with it.
    // Exit rather than throw: Next 14 would otherwise stay up serving 500s, and an
    // exited process fails Render's health check so the previous deploy keeps running.
    const { assertJwtSecret } = await import('@/lib/jwt-secret');
    try {
      assertJwtSecret();
    } catch (err) {
      console.error(`❌ ${(err as Error).message}. Refusing to start.`);
      process.exit(1);
    }

    const { checkAndAutoDistribute } = await import('@/lib/auto-distribute');
    const { runTrainingTick } = await import('@/lib/training/scheduler');
    const { runProjectsTick } = await import('@/lib/projects/scheduler');
    const { withJobLock } = await import('@/lib/job-lock');
    const { runDailyNotifications, pktHour } = await import('@/lib/notifications-daily');
    const { runReminders } = await import('@/lib/reminders/runner');
    const { runAutoReminders } = await import('@/lib/reminders/auto');
    const { expireGrants } = await import('@/lib/collab/expiry');
    const { runGithubQueue } = await import('@/lib/github/process');
    const { syncAllRepoAccess } = await import('@/lib/github/access');
    const { refreshHealth } = await import('@/lib/activity');
    const { runWorkUpdateReminders } = await import('@/lib/work-updates');

    // Each job runs on one instance at a time (job_locks lease), so two web
    // instances never distribute leads or deliver training events twice.
    const locked = (name: string, ttlMs: number, fn: () => Promise<unknown>, minIntervalMs = 0) =>
      withJobLock(name, { ttlMs, minIntervalMs }, fn).catch((err) => console.error(`[scheduler] ${name}`, err));

    // Check every 60 seconds if it's time to auto-distribute
    setInterval(async () => {
      try {
        await locked('auto-distribute', 15 * 60 * 1000, checkAndAutoDistribute);
      } finally {
        // Training: outbox → webhooks, ramp phases, badges, batches, coach digest
        await locked('training-tick', 10 * 60 * 1000, runTrainingTick);
        // Projects: open the next cycle of recurring projects (hourly)
        await locked('projects-tick', 10 * 60 * 1000, runProjectsTick, 60 * 60 * 1000);
        // Due-tomorrow reminders + email digests: once a day, from 09:00 PKT.
        if (pktHour() >= 9) await locked('daily-notifications', 10 * 60 * 1000, () => runDailyNotifications(), 20 * 60 * 60 * 1000);
        // Reminders: deliver what's due (every minute); create automatic ones (hourly).
        await locked('reminders', 5 * 60 * 1000, () => runReminders());
        await locked('auto-reminders', 10 * 60 * 1000, () => runAutoReminders(), 60 * 60 * 1000);
        // Temporary access (help requests, shares): mark expired grants and tell people (hourly).
        await locked('expire-grants', 10 * 60 * 1000, () => expireGrants(), 60 * 60 * 1000);
        // GitHub: process queued webhook deliveries (every minute).
        await locked('github-events', 5 * 60 * 1000, () => runGithubQueue());
        // Hourly: project health (green/yellow/red), repo access (expired helpers/guests drop out).
        await locked('project-health', 10 * 60 * 1000, () => refreshHealth(), 60 * 60 * 1000);
        await locked('repo-access-sync', 10 * 60 * 1000, () => syncAllRepoAccess(), 60 * 60 * 1000);
        // Manual-tracking projects: one work-update reminder per developer, from 18:00 PKT.
        if (pktHour() >= 18) await locked('work-update-reminders', 10 * 60 * 1000, () => runWorkUpdateReminders(), 20 * 60 * 60 * 1000);
      }
    }, 60 * 1000);

    console.log('⏰ Auto-distribution scheduler started (checking every 60s)');
  }
}
