const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`SELECT status, count(*) FROM department_documents GROUP BY status`);
  console.log(res.rows);
  const cats = await client.query(`SELECT DISTINCT category FROM department_documents`);
  console.log('categories:', cats.rows.map(r=>r.category));
  await client.end();
})();
