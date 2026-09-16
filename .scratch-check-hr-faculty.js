require("dotenv").config();
const { Client } = require("pg");
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query(`
    SELECT u.id as user_id, u.email, r.name as role, f.id as faculty_id, f.first_name, f.last_name, f.designation
    FROM users u
    JOIN roles r ON r.id = u.role_id
    LEFT JOIN faculty f ON f.user_id = u.id
    WHERE u.email = 'hrpayroll@sece.ac.in'
  `);
  console.log(res.rows);
  await client.end();
}
main().catch((err) => { console.error("ERROR:", err.message); process.exit(1); });
