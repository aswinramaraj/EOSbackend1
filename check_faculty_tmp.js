require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 8000 });
  await client.connect();
  const r = await client.query(`
    SELECT u.id as user_id, u.email, r.name as role, f.id as faculty_id, f.designation, f.department_id
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN faculty f ON f.user_id = u.id
    WHERE u.email IN ('media_room@eos.test','medical_centre@eos.test','hostel_warden@eos.test','warden@eos.test','sports_admin@eos.test','library@eos.test')
       OR r.name IN ('medical_centre','warden','sports_admin','library','media_room')
    ORDER BY r.name;
  `);
  console.log(r.rows);
  await client.end();
})().catch(e => { console.error(e.message); process.exit(1); });
