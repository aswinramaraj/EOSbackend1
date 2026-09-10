const { Client } = require('pg');
require('dotenv').config();

async function main() {
  const manifest = JSON.parse(require('fs').readFileSync('_zzseed_manifest.json', 'utf8'));
  const t = manifest.tables;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query('BEGIN');

    const del = async (table, ids) => {
      if (!ids || ids.length === 0) return;
      await client.query(`DELETE FROM ${table} WHERE id = ANY($1::int[])`, [ids]);
    };

    await del('sports_achievements', t.sports_achievements);
    await del('sports_teams', t.sports_teams);
    await del('faculty_publications', t.faculty_publications);
    await del('faculty', t.faculty);
    await del('students', t.students);
    await del('users', t.users);
    await del('courses', t.courses);
    await del('batches', t.batches);
    await del('quotas', t.quotas);
    await del('departments', t.departments);

    await client.query('COMMIT');
    console.log('cleanup committed');

    const allTables = Object.keys(t);
    for (const table of allTables) {
      const ids = t[table];
      const res = await client.query(`SELECT count(*) FROM ${table} WHERE id = ANY($1::int[])`, [ids]);
      console.log(table, 'remaining tracked rows:', res.rows[0].count);
    }
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('CLEANUP FAILED, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
