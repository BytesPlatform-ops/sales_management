// Migration script to create sales table
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
    console.log('Creating sales table...');
    
    // Create the sales table
    await client.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        agent_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        customer_name VARCHAR(255) NOT NULL,
        total_deal_value DECIMAL(12, 2) NOT NULL CHECK (total_deal_value > 0),
        amount_collected DECIMAL(12, 2) NOT NULL DEFAULT 0 CHECK (amount_collected >= 0),
        status VARCHAR(20) NOT NULL DEFAULT 'partial' CHECK (status IN ('partial', 'completed')),
        commission_paid BOOLEAN NOT NULL DEFAULT FALSE,
        commission_amount DECIMAL(12, 2) DEFAULT 0,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `);
    
    console.log('✅ Sales table created');
    
    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_agent_id ON sales(agent_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at)`);
    
    console.log('✅ Indexes created');
    
    // Create trigger function
    await client.query(`
      CREATE OR REPLACE FUNCTION update_sales_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    
    // Create trigger
    await client.query(`DROP TRIGGER IF EXISTS trigger_sales_updated_at ON sales`);
    await client.query(`
      CREATE TRIGGER trigger_sales_updated_at
        BEFORE UPDATE ON sales
        FOR EACH ROW
        EXECUTE FUNCTION update_sales_updated_at()
    `);
    
    console.log('✅ Trigger created');
    
    // Verify the table
    const result = await client.query(`
      SELECT column_name, data_type, column_default 
      FROM information_schema.columns 
      WHERE table_name = 'sales'
      ORDER BY ordinal_position
    `);
    
    console.log('\nTable columns:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
