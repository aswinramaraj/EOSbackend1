const { Client } = require('pg');
require('dotenv').config();

const ids = [27005,27007,27009,27011,27013,27014,27017,27019,27021,27023,27025,27026,27028,27030,27032,27034,27036,27038,27040,27042];

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query('BEGIN');
    const before = await client.query('SELECT id, email FROM users WHERE id = ANY($1::int[])', [ids]);
    console.log('Rows found before delete:', before.rows.length);
    const del = await client.query('DELETE FROM users WHERE id = ANY($1::int[])', [ids]);
    console.log('Deleted rows:', del.rowCount);
    await client.query('COMMIT');

    const after = await client.query('SELECT id, email FROM users WHERE id = ANY($1::int[])', [ids]);
    console.log('Rows remaining after delete (should be 0):', after.rows.length);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('Error, rolled back:', e.message);
  } finally {
    await client.end();
  }
})();
