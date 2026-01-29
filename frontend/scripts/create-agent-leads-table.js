/**
 * Script to create the agent_leads table for the Lead Verification System
 * Run with: node scripts/create-agent-leads-table.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const pool = new Pool({
  host: process.env.DB_HOST || 'aws-1-ap-southeast-2.pooler.supabase.com',
  port: parseInt(process.env.DB_PORT || '6543', 10),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER || 'postgres.wcwaslfuvuboexuldtzy',
  password: process.env.DB_PASSWORD || '!Bytes!0712',
  ssl: {
    rejectUnauthorized: false,
  },
});

async function runMigration() {
  const client = await pool.connect();
  
  try {
    console.log('🚀 Running agent_leads table migration...\n');

    // Read the migration file
    const migrationPath = path.join(__dirname, '../database/migrations/create_agent_leads_table.sql');
    const migration = fs.readFileSync(migrationPath, 'utf8');

    // Execute each statement
    const statements = migration
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      try {
        await client.query(statement);
        console.log('✅ Executed:', statement.substring(0, 60) + '...');
      } catch (err) {
        // Skip if table/index already exists
        if (err.code === '42P07' || err.code === '42710') {
          console.log('⏭️  Skipped (already exists):', statement.substring(0, 60) + '...');
        } else {
          throw err;
        }
      }
    }

    console.log('\n✅ Migration completed successfully!');
    
    // Verify the table was created
    const result = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'agent_leads'
      ORDER BY ordinal_position
    `);

    console.log('\n📋 agent_leads table structure:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} ${row.column_default ? `(default: ${row.column_default})` : ''}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
