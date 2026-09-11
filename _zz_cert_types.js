const { Client } = require('pg');
require('dotenv').config();
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`SELECT * FROM certificate_types LIMIT 20`);
  console.log(res.rows);
  await client.end();
})();
