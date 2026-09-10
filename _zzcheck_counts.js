const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const tables = ['users', 'roles', 'user_roles', 'departments', 'faculty', 'students', 'faculty_publications', 'sports_achievements', 'iqac_metric_targets'];
  for (const t of tables) {
    try {
      const res = await client.query(`SELECT count(*) FROM ${t}`);
      console.log(t, res.rows[0].count);
    } catch (e) {
      console.log(t, 'ERROR', e.message);
    }
  }
  await client.end();
}
main();
