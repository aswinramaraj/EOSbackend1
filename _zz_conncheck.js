const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  try {
    await client.connect();
    const res = await client.query(`SELECT pid, usename, application_name, client_addr, state, query_start, now()-query_start as age, left(query,80) as query FROM pg_stat_activity ORDER BY query_start`);
    console.log('total sessions:', res.rows.length);
    console.log(res.rows);
  } catch (e) {
    console.error('CONNECT FAILED:', e.message);
  } finally {
    await client.end().catch(()=>{});
  }
})();
