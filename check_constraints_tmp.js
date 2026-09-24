require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await client.connect();
  const r = await client.query(`
    SELECT conname, pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conrelid = 'book_borrow_records'::regclass AND contype = 'c'
  `);
  console.log(r.rows);
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
