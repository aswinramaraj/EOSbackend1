require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  try {
    await client.connect();
    const r = await client.query('SELECT 1 as ok');
    console.log('DB reachable:', r.rows);
  } catch (e) {
    console.log('DB unreachable:', e.message);
  } finally {
    await client.end().catch(() => {});
  }
})();
