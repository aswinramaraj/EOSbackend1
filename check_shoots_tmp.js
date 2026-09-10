require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  await client.connect();
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable FROM information_schema.columns
    WHERE table_name = 'media_shoot_assignments' ORDER BY ordinal_position
  `);
  console.log(cols.rows);
  const count = await client.query(`SELECT count(*) FROM media_shoot_assignments`);
  console.log("row count:", count.rows[0].count);
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
