require('dotenv').config();
const { Client } = require('pg');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(
    "SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'book_borrow_records_check'"
  );
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
})().catch((e) => { console.error(e); process.exit(1); });
