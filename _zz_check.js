const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name='student_certifications'`);
  console.log('exists:', res.rows.length > 0);
  if (res.rows.length > 0) {
    const cols = await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='student_certifications' ORDER BY ordinal_position`);
    console.log(cols.rows);
  }
  await client.end();
})();
