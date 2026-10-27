#!/usr/bin/env node
/**
 * Set (or reset) a user's password.
 *
 * Usage (from frontend/):
 *   node scripts/set-password.js <username> '<new-password>'
 *
 * DB connection comes from the environment (DB_HOST, DB_PORT, DB_NAME, DB_USER,
 * DB_PASSWORD), falling back to frontend/.env.local. No credentials live here.
 * The password is hashed with bcrypt (same as the app) before saving.
 * Wrap the password in single quotes so special characters are safe.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.error("Usage: node scripts/set-password.js <username> '<new-password>'");
  process.exit(1);
}

const envPath = path.join(__dirname, '..', '.env.local');
const envFile = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : '';
const g = (k) => {
  if (process.env[k]) return process.env[k];
  const m = envFile.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : undefined;
};

const missing = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'].filter((k) => !g(k));
if (missing.length) {
  console.error(`Missing ${missing.join(', ')} (set them in the environment or frontend/.env.local).`);
  process.exit(1);
}

const client = new Client({
  host: g('DB_HOST'),
  port: Number(g('DB_PORT')),
  database: g('DB_NAME'),
  user: g('DB_USER'),
  password: g('DB_PASSWORD'),
  ssl: g('DB_SSL') === 'false' ? false : { rejectUnauthorized: false },
});

(async () => {
  try {
    await client.connect();
    const hash = bcrypt.hashSync(newPassword, 10);
    const res = await client.query(
      'UPDATE users SET password = $1 WHERE username = $2 RETURNING id, username',
      [hash, username]
    );
    if (res.rows.length === 0) {
      console.error(`No user found with username "${username}".`);
      process.exit(1);
    }
    console.log(`✅ Password updated for ${res.rows[0].username} (id ${res.rows[0].id}).`);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();
