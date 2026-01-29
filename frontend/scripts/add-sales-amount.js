// Migration script to add sales_amount column to daily_stats table
const { Pool } = require('pg');

const pool = new Pool({
  host: 'aws-1-ap-southeast-2.pooler.supabase.com',
  port: 6543,
  user: 'postgres.wcwaslfuvuboexuldtzy',
  password: '!Bytes!0712',
  database: 'postgres',
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('Adding sales_amount column to daily_stats table...');
    
    // Add the column if it doesn't exist
    await client.query(`
      ALTER TABLE daily_stats ADD COLUMN IF NOT EXISTS sales_amount DECIMAL(12, 2) DEFAULT 0
    `);
    
    console.log('✅ sales_amount column added successfully');
    
    // Verify the column
    const result = await client.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'daily_stats' AND column_name = 'sales_amount'
    `);
    
    console.log('Column info:', result.rows[0]);
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
