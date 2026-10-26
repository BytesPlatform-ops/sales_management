#!/usr/bin/env node
/**
 * Apply the training-module migrations in one transaction.
 *
 *   node scripts/apply-training-migration.js --dry-run   # run everything, then ROLLBACK
 *   node scripts/apply-training-migration.js             # run and COMMIT
 *
 * Reads DB_HOST / DB_PORT / DB_NAME / DB_USER / DB_PASSWORD from the environment
 * (or frontend/.env.local). Both files are idempotent, so re-running is safe.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

// Default: the training module. Pass .sql file names to run others, e.g.
//   node scripts/apply-training-migration.js --dry-run create_projects_module.sql
const ARG_FILES = process.argv.slice(2).filter((a) => a.endsWith('.sql'));
const FILES = ARG_FILES.length ? ARG_FILES : [
  'create_training_module.sql',
  'seed_training_content.sql',
];

function loadEnvFile(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] !== '' && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  loadEnvFile(path.join(__dirname, '..', '.env.local'));
  loadEnvFile(path.join(__dirname, '..', '.env'));

  for (const k of ['DB_HOST', 'DB_USER', 'DB_PASSWORD']) {
    if (!process.env[k]) {
      console.error(`Missing ${k}. Set DB_* env vars (see frontend/.env.local).`);
      process.exit(1);
    }
  }

  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '6543', 10),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const dir = path.join(__dirname, '..', '..', 'database', 'migrations');
  try {
    await client.query('BEGIN');
    for (const f of FILES) {
      const full = path.join(dir, f);
      if (!fs.existsSync(full)) {
        console.warn(`skip ${f} (not found)`);
        continue;
      }
      // Each file wraps itself in BEGIN/COMMIT for standalone use; strip those so
      // everything runs in this script's single transaction.
      const sql = fs.readFileSync(full, 'utf8')
        .replace(/^\s*BEGIN\s*;\s*$/gim, '')
        .replace(/^\s*COMMIT\s*;\s*$/gim, '');
      const t = Date.now();
      await client.query(sql);
      console.log(`ok  ${f} (${Date.now() - t} ms)`);
    }

    const counts = ARG_FILES.length ? { rows: [] } : await client.query(`
      SELECT (SELECT COUNT(*) FROM training_tracks) AS tracks,
             (SELECT COUNT(*) FROM training_courses) AS courses,
             (SELECT COUNT(*) FROM training_lessons) AS lessons,
             (SELECT COUNT(*) FROM training_quiz_questions) AS questions,
             (SELECT COUNT(*) FROM training_flashcards) AS flashcards,
             (SELECT COUNT(*) FROM training_roleplay_scenarios) AS scenarios,
             (SELECT COUNT(*) FROM training_objections) AS objections,
             (SELECT COUNT(*) FROM training_classification_items) AS classification_items,
             (SELECT COUNT(*) FROM training_ramp_status) AS ramp_rows`);
    console.table(counts.rows);

    if (dryRun) {
      await client.query('ROLLBACK');
      console.log('DRY RUN: rolled back, nothing was changed.');
    } else {
      await client.query('COMMIT');
      console.log('Committed.');
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('FAILED, rolled back:', err.message);
    if (err.position) console.error('at position', err.position);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
