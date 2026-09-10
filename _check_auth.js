const { Client } = require('pg');
require('dotenv').config();
const crypto = require('crypto');

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const res = await client.query("SELECT id, email, password_hash, status, role_id FROM users WHERE email = $1", ['iqac@eos.test']);
  console.log('Row:', res.rows);
  const expectedHash = crypto.createHash('sha256').update('EOS@test123').digest('hex');
  console.log('Expected hash for EOS@test123:', expectedHash);
  await client.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
