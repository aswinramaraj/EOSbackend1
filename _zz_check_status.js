const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`SELECT status, count(*) FROM incubations GROUP BY status`);
  console.log(res.rows);
  const total = await client.query(`SELECT count(*) FROM student_entrepreneurship`);
  console.log('total ventures:', total.rows[0].count);
  const inc = await client.query(`SELECT count(*) FROM incubations`);
  console.log('total incubations:', inc.rows[0].count);
  await client.end();
})();
