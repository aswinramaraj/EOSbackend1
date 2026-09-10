const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) as def
    FROM pg_constraint
    WHERE conrelid = 'students'::regclass AND contype = 'c'
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
