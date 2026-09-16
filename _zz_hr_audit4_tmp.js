const { Client } = require('pg');
const envtxt = require('fs').readFileSync('.env', 'utf8');
envtxt.split(/\r?\n/).forEach(l => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
});
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const q = async (label, sql) => {
    try {
      const res = await client.query(sql);
      console.log(`\n=== ${label} (${res.rowCount} rows) ===`);
      console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
      console.log(`\n=== ${label} ERROR ===`);
      console.log(e.message);
    }
  };
  await q('users with role_id=25', `select id, email from users where role_id=25`);
  await q('departments non-academic-ish', `select id, name, code from departments where name ilike '%admin%' or name ilike '%hr%' or code in ('ADMIN','HR')`);
  await q('all departments', `select id, name, code from departments order by id`);
  await q('non_teaching_staff department distribution', `select department_id, count(*) from non_teaching_staff group by 1`);
  await client.end();
}
main().catch(e => { console.error(e); process.exit(1); });
