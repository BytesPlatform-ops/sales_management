// Script to add approval columns to sales table
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'aws-1-ap-southeast-2.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '6543', 10),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.wcwaslfuvuboexuldtzy',
  password: process.env.DB_PASSWORD || '!Bytes!0712',
  ssl: { rejectUnauthorized: false },
});

async function runMigration() {
  const client = await pool.connect();
  try {
    console.log('🚀 Running add_sales_approval.sql migration...');
    const migrationPath = path.join(__dirname, '../database/migrations/add_sales_approval.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');
    const statements = migration.split(';').map(s => s.trim()).filter(s => s.length > 0 && !s.startsWith('--'));
    for (const statement of statements) {
      try {
        await client.query(statement);
        console.log('✅ Executed:', statement.substring(0, 60) + '...');
      } catch (err) {
        if (err.code === '42701' || err.code === '42P07' || err.code === '42710') {
          console.log('⏭️  Skipped (already exists):', statement.substring(0, 60) + '...');
        } else {
          throw err;
        }
      }
    }
    console.log('✅ Migration completed!');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
runMigration();
