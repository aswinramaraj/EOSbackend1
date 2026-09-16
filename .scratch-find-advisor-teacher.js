require("dotenv").config();
const { Client } = require("pg");

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const res = await client.query(`
    SELECT DISTINCT
      f.id as faculty_id, f.first_name, f.last_name, u.email,
      cm.class_id, c.section, d.code as dept_code,
      m.subject_id, s.name as subject_name
    FROM class_mentors cm
    JOIN faculty f ON f.id = cm.faculty_id
    JOIN users u ON u.id = f.user_id
    JOIN classes c ON c.id = cm.class_id
    JOIN departments d ON d.id = c.department_id
    JOIN faculty_subject_class_mapping m ON m.faculty_id = cm.faculty_id AND m.class_id = cm.class_id
    JOIN subjects s ON s.id = m.subject_id
    ORDER BY cm.class_id
    LIMIT 10
  `);
  console.log("advisors who ALSO teach a subject for their own class:", JSON.stringify(res.rows, null, 2));

  await client.end();
}
main().catch((err) => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
