require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 15000 });
  await client.connect();
  const check = await client.query("SELECT id, subject FROM hr_payroll_requests WHERE id = 5");
  console.log("before delete:", check.rows);
  if (check.rows.length === 1 && check.rows[0].subject === 'Verification test query') {
    const del = await client.query("DELETE FROM hr_payroll_requests WHERE id = 5 AND subject = 'Verification test query'");
    console.log("deleted:", del.rowCount);
  } else {
    console.log("safety check failed, not deleting");
  }
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
