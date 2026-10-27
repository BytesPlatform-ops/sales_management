/** Fresh schema for integration tests: minimal users + notifications, then the real migrations. */
import { readFileSync } from 'fs';
import path from 'path';
import { Client } from 'pg';
import { SignJWT } from 'jose';

export function assertSafeDb() {
  const host = process.env.DB_HOST || '';
  const name = process.env.DB_NAME || '';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || !/_test$/.test(name)) {
    throw new Error(`Refusing to run integration tests against ${host}/${name}: use a local database whose name ends in _test`);
  }
}

const MIGRATIONS = ['create_projects_module.sql', 'fix_projects_sale_id_uuid.sql', 'create_project_env.sql', 'create_tickets_media.sql', 'create_notifications_search.sql', 'create_views_backlog.sql', 'create_brief_thread.sql', 'create_ceo_role.sql', 'create_reminders.sql', 'create_collaboration.sql', 'create_sales_teams.sql', 'create_chat.sql', 'create_github_tracking.sql'];

export async function resetDb() {
  assertSafeDb();
  const c = new Client({
    host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), database: process.env.DB_NAME,
    user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: false,
  });
  await c.connect();
  try {
    await c.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    await c.query(`
      CREATE TABLE users (
        id BIGSERIAL PRIMARY KEY, username VARCHAR(50) UNIQUE NOT NULL, password VARCHAR(255) NOT NULL DEFAULT 'x',
        full_name VARCHAR(100) NOT NULL, role VARCHAR(20) NOT NULL, is_active BOOLEAN DEFAULT TRUE, email_address VARCHAR(200),
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        -- the columns the older HR routes read (production schema + profile migrations)
        extension_number VARCHAR(20), base_salary BIGINT DEFAULT 1, sales_target INTEGER DEFAULT 0,
        shift_start TIME DEFAULT '21:00', shift_end TIME DEFAULT '05:00', employment_type VARCHAR(20) DEFAULT 'full_time',
        date_of_joining DATE, date_of_birth DATE, phone VARCHAR(50), personal_email VARCHAR(200), cnic VARCHAR(50), address TEXT,
        emergency_contact_name VARCHAR(100), emergency_contact_phone VARCHAR(50), bank_name VARCHAR(100),
        bank_account_title VARCHAR(100), bank_account_number VARCHAR(100), email_name VARCHAR(100));
      CREATE TABLE training_notifications (
        id SERIAL PRIMARY KEY, user_id BIGINT NOT NULL, type VARCHAR(40) NOT NULL, body TEXT NOT NULL, link TEXT,
        read_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);`);
    for (const f of MIGRATIONS) {
      await c.query(readFileSync(path.join(__dirname, '../../../database/migrations', f), 'utf8'));
    }
  } finally {
    await c.end();
  }
}

export async function tokenFor(user: { id: number; username: string; role: string }) {
  return new SignJWT({ userId: user.id, username: user.username, role: user.role })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('1h')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET!));
}
