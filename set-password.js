#!/usr/bin/env node
/**
 * Set (or reset) a user's password in the Salary System database.
 *
 * Usage:
 *   node set-password.js <username> '<new-password>'
 *
 * Example (put your OLD password back):
 *   node set-password.js hr_admin 'myOldPasswordHere'
 *
 * The password is hashed with bcrypt (same as the app) before saving.
 * Wrap the password in single quotes so special characters are safe.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const bcrypt = require('./node_modules/bcryptjs');

const [, , username, newPassword] = process.argv;

if (!username || !newPassword) {
  console.error("Usage: node set-password.js <username> '<new-password>'");
  process.exit(1);
}

// Read DB credentials from frontend/.env.local
const envPath = path.join(__dirname, 'frontend', '.env.local');
const env = fs.readFileSync(envPath, 'utf8');
const g = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : undefined;
};

const client = new Client({
  host: g('DB_HOST'),
  port: g('DB_PORT'),
  database: g('DB_NAME'),
  user: g('DB_USER'),
  password: g('DB_PASSWORD'),
  ssl: { rejectUnauthorized: false },
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
