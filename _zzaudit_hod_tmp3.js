const { Client } = require('pg');
require('dotenv').config({ path: 'C:/Users/shona/OneDrive/Documents/EOS1/EOSbackend1/.env' });

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  async function q(label, sql) {
    try {
      const res = await client.query(sql);
      console.log(`\n=== ${label} (${res.rowCount} rows) ===`);
      console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
      console.log(`\n=== ${label} ERROR ===`);
      console.log(e.message);
    }
  }
  await q('faculty_od_requests pending dept75', `
    select fo.* from faculty_od_requests fo join faculty f on f.id=fo.faculty_id
    where f.department_id=75 and fo.hod_approval_status='pending'
  `);
  await q('faculty_od_requests sample any', `select * from faculty_od_requests order by id desc limit 3`);
  await q('od_requests id=1 detail', `select * from od_requests where id=1`);
  await q('od_teams for request 1', `select * from od_teams where id in (select team_id from od_requests where id=1)`);
  await q('max wallet_transactions id', `select max(id) from wallet_transactions`);
  await q('wallet id for user 38525 (dm partner, for txn ref)', `select id, user_id from wallets where user_id in (38512,38525)`);
  await q('faculty_leave_balances for 3503', `select * from faculty_leave_balances where faculty_id=3503`);
  await q('faculty_leave_balances sample', `select * from faculty_leave_balances limit 5`);
  await client.end();
}
main().catch(e=>{console.error(e);process.exit(1);});
