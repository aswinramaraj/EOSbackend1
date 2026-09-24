require('dotenv').config({ path: 'C:\\Users\\shona\\OneDrive\\Documents\\EOS1\\EOSbackend1\\.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const log = (label, res) => {
    console.log('\n=== ' + label + ' ===');
    console.table ? console.log(JSON.stringify(res.rows, null, 2)) : console.log(res.rows);
  };

  // 1. Wallet samples
  log('sample wallets', await client.query(`SELECT * FROM wallets ORDER BY id LIMIT 5`));
  log('sample wallet_transactions', await client.query(`SELECT * FROM wallet_transactions ORDER BY id DESC LIMIT 10`));
  log('this student wallet check', await client.query(`SELECT * FROM wallets WHERE user_id = 40693`));
  log('max wallet id', await client.query(`SELECT max(id) FROM wallets`));
  log('max wallet_transactions id', await client.query(`SELECT max(id) FROM wallet_transactions`));
  log('wallet_outlets', await client.query(`SELECT * FROM wallet_outlets LIMIT 10`));

  // 2. Placement
  log('placement_drives eligible for AIDS/CSE recent/open', await client.query(`
    SELECT pd.*, c.name as company_name FROM placement_drives pd
    JOIN companies c ON c.id = pd.company_id
    WHERE pd.scheduled_date >= CURRENT_DATE - INTERVAL '120 days'
    ORDER BY pd.scheduled_date DESC LIMIT 20
  `));
  log('sample student_drive_applications', await client.query(`SELECT * FROM student_drive_applications ORDER BY id DESC LIMIT 10`));
  log('this student applications', await client.query(`SELECT * FROM student_drive_applications WHERE student_id = 20884`));
  log('max student_drive_applications id', await client.query(`SELECT max(id) FROM student_drive_applications`));
  log('sample placement_interviews', await client.query(`SELECT * FROM placement_interviews ORDER BY id DESC LIMIT 5`));

  // check batch/course of student
  log('student class info', await client.query(`
    SELECT s.id as student_id, s.class_id, cl.batch_id, cl.department_id, cl.course_id, cl.section
    FROM students s JOIN classes cl ON cl.id = s.class_id WHERE s.id = 20884
  `));

  await client.end();
}

main().catch(e => { console.error(e); process.exit(1); });
