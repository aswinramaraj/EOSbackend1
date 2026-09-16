require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const r = await client.query(`SELECT u.id, u.email FROM users u WHERE u.id = 38880`);
  console.log(JSON.stringify(r.rows));
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
