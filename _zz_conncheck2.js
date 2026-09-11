const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const res = await client.query(`SELECT count(*) FROM pg_stat_activity`);
    console.log('total pg_stat_activity rows:', res.rows[0].count);
    const byApp = await client.query(`SELECT application_name, usename, state, count(*) FROM pg_stat_activity GROUP BY application_name, usename, state ORDER BY count(*) DESC`);
    console.log(byApp.rows);
  } catch (e) {
    console.error('CONNECT FAILED:', e.message);
  } finally {
    await client.end().catch(()=>{});
  }
})();
