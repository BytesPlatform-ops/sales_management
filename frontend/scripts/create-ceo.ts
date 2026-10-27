#!/usr/bin/env tsx
/**
 * Create a CEO account and print a single-use invite link (valid 72 hours).
 * The person sets their own password from the link, then sets up an authenticator
 * app on first sign-in. No password is ever passed or stored here.
 *
 * Usage (from frontend/, with DB_* and APP_BASE_URL in the environment or .env.local):
 *   npx tsx scripts/create-ceo.ts <username> <email> "<Full Name>"
 * If SENDGRID_API_KEY + NOTIFY_FROM_EMAIL are set, the link is emailed too.
 *
 * Refuses if any CEO already exists unless --another is given (later CEOs should be
 * added from the app by a CEO in Admin mode).
 */
import fs from 'fs';
import path from 'path';

const envPath = path.join(__dirname, '..', '.env.local');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const another = process.argv.includes('--another');
  const [username, email, fullName] = args;
  if (!username || !email) {
    console.error('Usage: npx tsx scripts/create-ceo.ts <username> <email> "<Full Name>" [--another]');
    process.exit(1);
  }
  const { queryOne, pool } = await import('../lib/db');
  const { createCeoAccount } = await import('../lib/auth/ceo-users');
  try {
    const existing = await queryOne<{ n: number }>(`SELECT COUNT(*)::int AS n FROM users WHERE role = 'ceo'`);
    if (existing && existing.n > 0 && !another) {
      console.error('A CEO account already exists. Add more CEOs from the app (Admin mode), or pass --another.');
      process.exit(1);
    }
    const r = await createCeoAccount({ username, email, full_name: fullName || username }, null);
    console.log(`✅ CEO account created: ${r.username} (id ${r.id})`);
    console.log(`Invite link (single use, 72 hours):\n${r.invite_url}`);
    if (!r.invite_url.startsWith('http')) console.log('Tip: set APP_BASE_URL to print a full URL.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('Error:', e?.message || e);
  process.exit(1);
});
