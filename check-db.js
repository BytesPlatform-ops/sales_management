const { Pool } = require('pg');

const pool = new Pool({
  host: 'aws-1-ap-southeast-2.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  user: 'postgres.wcwaslfuvuboexuldtzy',
  password: process.env.DB_PASSWORD || '!Bytes!0712',
  ssl: { rejectUnauthorized: false }
});

async function check() {
  try {
    // Test correct parsing with MM:SS format
    const callData = await pool.query(`
      SELECT 
        agent_extension,
        COUNT(*) as call_count,
        SUM(
          (CAST(SPLIT_PART(call_duration, ':', 1) AS INTEGER) * 60 +
           CAST(SPLIT_PART(call_duration, ':', 2) AS INTEGER))
        ) as talk_time_seconds
      FROM call_logs
      WHERE DATE(call_time AT TIME ZONE 'Asia/Karachi') = '2026-02-02'::date
      GROUP BY agent_extension
      ORDER BY agent_extension
    `);
    
    console.log('Corrected call data for 2026-02-02 (Feb 2):');
    callData.rows.forEach(r => {
      const minutes = Math.floor(r.talk_time_seconds / 60);
      const seconds = r.talk_time_seconds % 60;
      console.log(` - Ext ${r.agent_extension}: ${r.call_count} calls, ${r.talk_time_seconds}s = ${minutes}m ${seconds}s`);
    });
    
    await pool.end();
  } catch (err) {
    console.error('Error:', err.message);
  }
}

check();
