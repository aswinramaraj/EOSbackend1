require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await client.connect();
  const r = await client.query(`SELECT id, name, code FROM departments ORDER BY id`);
  console.log(r.rows);
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
