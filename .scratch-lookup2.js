require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const emails = ['uday.u.cs4@sece.ac.in', 'hodcse@sece.ac.in', 'hrpayroll@sece.ac.in'];
  for (const email of emails) {
    const u = await client.query(`SELECT id, email, role_id FROM users WHERE email = $1`, [email]);
    console.log('USER', email, JSON.stringify(u.rows));
    if (u.rows.length) {
      const userId = u.rows[0].id;
      const f = await client.query(`SELECT id, first_name, last_name, department_id FROM faculty WHERE user_id = $1`, [userId]);
      console.log('FACULTY ROW', JSON.stringify(f.rows));
    }
  }
  await client.end();
})().catch(e => { console.error(e); process.exit(1); });
