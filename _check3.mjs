import pg from 'pg';
import fs from 'fs';
const envContent = fs.readFileSync('.env', 'utf-8');
const match = envContent.match(/DATABASE_URL="([^"]+)"/);
const client = new pg.Client({ connectionString: match[1], connectionTimeoutMillis: 25000 });
(async () => {
  try {
    await client.connect();
    const cols = await client.query(`
      SELECT column_name, data_type, udt_name, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns WHERE table_name='faculty_daily_attendance' ORDER BY ordinal_position
    `);
    console.log('columns:', JSON.stringify(cols.rows, null, 2));
    const constraints = await client.query(`
      SELECT tc.constraint_type, kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
      FROM information_schema.table_constraints tc
      LEFT JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      LEFT JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_name = 'faculty_daily_attendance'
    `);
    console.log('constraints:', JSON.stringify(constraints.rows, null, 2));
    const allEnums = await client.query(`
      SELECT DISTINCT udt_name FROM information_schema.columns WHERE table_name='faculty_daily_attendance' AND data_type='USER-DEFINED'
    `);
    console.log('enum type names:', JSON.stringify(allEnums.rows, null, 2));
    if (allEnums.rows.length) {
      const typ = allEnums.rows[0].udt_name;
      const enumVals = await client.query(`SELECT enumlabel FROM pg_enum WHERE enumtypid = $1::regtype`, [typ]);
      console.log('enum values for', typ, ':', JSON.stringify(enumVals.rows));
    }
  } catch (e) {
    console.error('Error:', e.message);
    process.exitCode = 1;
  } finally {
    try { await client.end(); } catch {}
  }
})();
