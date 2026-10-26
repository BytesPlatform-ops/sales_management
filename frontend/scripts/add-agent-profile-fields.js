const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

// Credentials come from the environment (e.g. `node --env-file=.env.local scripts/add-agent-profile-fields.js`)
for (const key of ['DB_HOST', 'DB_USER', 'DB_PASSWORD']) {
  if (!process.env[key]) {
    console.error(`Missing ${key} in environment`);
    process.exit(1);
  }
}

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || '6543', 10),
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false }
});

async function migrate() {
  try {
    const sql = fs.readFileSync(
      path.join(__dirname, '../../database/migrations/add_agent_profile_fields.sql'),
      'utf8'
    );
    await pool.query(sql);
    console.log('✅ Agent profile columns added successfully');

    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users'
        AND column_name IN ('date_of_joining', 'date_of_birth', 'phone', 'personal_email', 'cnic', 'address',
                            'emergency_contact_name', 'emergency_contact_phone',
                            'bank_name', 'bank_account_title', 'bank_account_number')
    `);
    console.log('Columns:', result.rows);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
}

migrate();
