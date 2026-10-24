import { Pool, types } from 'pg';

// call_logs.call_time etc. are `timestamp without time zone` holding UTC. pg parses
// those in the server's local zone, so a host with TZ=Asia/Karachi shifted every
// time by 5h. Always read them as UTC.
types.setTypeParser(1114, (value: string) => new Date(value.replace(' ', 'T') + 'Z'));

// Database configuration for Next.js API routes
const pool = new Pool({
  host: process.env.DB_HOST || 'aws-1-ap-southeast-2.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '6543', 10),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.wcwaslfuvuboexuldtzy',
  password: process.env.DB_PASSWORD || '!Bytes!0712',
  // DB_SSL=false only for local databases (e.g. a test Postgres); Supabase needs SSL.
  ssl: process.env.DB_SSL === 'false' ? false : {
    rejectUnauthorized: false,
  },
  max: process.env.DB_POOL_MAX ? parseInt(process.env.DB_POOL_MAX, 10) : 10,
  idleTimeoutMillis: 30000,
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = any>(text: string, params?: any[]): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] || null;
}

export { pool };
