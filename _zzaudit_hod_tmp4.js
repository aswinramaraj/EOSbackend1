const { Client } = require('pg');
require('dotenv').config({ path: 'C:/Users/shona/OneDrive/Documents/EOS1/EOSbackend1/.env' });
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`select * from wallet_transactions where status='success' order by id desc limit 5`);
  console.log(JSON.stringify(res.rows, null, 2));
  const res2 = await client.query(`select * from wallet_outlets`);
  console.log(JSON.stringify(res2.rows, null, 2));
  await client.end();
}
main();
