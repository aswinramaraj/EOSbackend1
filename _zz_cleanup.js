const { Client } = require('pg');
require('dotenv').config();

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');

    const checks = [
      ['student_drive_applications', 'id', 3641],
      ['sports_achievements', 'id', 16],
      ['faculty_publications', 'id', 65],
      ['classes', 'id', 1281],
    ];
    for (const [table, col, id] of checks) {
      const before = await client.query(`SELECT ${col} FROM ${table} WHERE ${col} = $1`, [id]);
      const del = await client.query(`DELETE FROM ${table} WHERE ${col} = $1`, [id]);
      console.log(table, 'found:', before.rows.length, 'deleted:', del.rowCount);
    }

    await client.query('COMMIT');

    for (const [table, col, id] of checks) {
      const after = await client.query(`SELECT ${col} FROM ${table} WHERE ${col} = $1`, [id]);
      console.log(table, 'remaining after delete (should be 0):', after.rows.length);
    }
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error, rolled back:', e.message);
  } finally {
    await client.end();
  }
})();
