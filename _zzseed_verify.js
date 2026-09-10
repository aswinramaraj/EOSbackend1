const { Client } = require('pg');
const crypto = require('crypto');
require('dotenv').config();

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const manifest = { tables: {} };
  const track = (table, id) => {
    manifest.tables[table] = manifest.tables[table] || [];
    manifest.tables[table].push(id);
  };

  try {
    await client.query('BEGIN');

    const roleRow = async (name) => {
      const r = await client.query('SELECT id FROM roles WHERE name = $1', [name]);
      if (r.rows.length === 0) throw new Error('role not found: ' + name);
      return r.rows[0].id;
    };
    const iqacRoleId = await roleRow('iqac');
    const studentRoleId = await roleRow('student');
    const facultyRoleId = await roleRow('faculty');

    const dept = async (name, code) => {
      const r = await client.query(
        'INSERT INTO departments (name, code) VALUES ($1, $2) RETURNING id',
        [name, code],
      );
      track('departments', r.rows[0].id);
      return r.rows[0].id;
    };
    const deptA = await dept('ZZ Test Dept A', 'ZZDEPTA');
    const deptB = await dept('ZZ Test Dept B', 'ZZDEPTB');

    const course = async (name, code, departmentId) => {
      const r = await client.query(
        'INSERT INTO courses (name, code, department_id) VALUES ($1, $2, $3) RETURNING id',
        [name, code, departmentId],
      );
      track('courses', r.rows[0].id);
      return r.rows[0].id;
    };
    const courseA = await course('ZZ Test Course A', 'ZZCOURSEA', deptA);
    const courseB = await course('ZZ Test Course B', 'ZZCOURSEB', deptB);

    const batchR = await client.query(
      "INSERT INTO batches (name, start_year, end_year) VALUES ('ZZ2026-Batch', 2026, 2030) RETURNING id",
    );
    const batchId = batchR.rows[0].id;
    track('batches', batchId);

    const quotaR = await client.query(
      "INSERT INTO quotas (name) VALUES ('ZZ Test Quota') RETURNING id",
    );
    const quotaId = quotaR.rows[0].id;
    track('quotas', quotaId);

    const user = async (email, roleId) => {
      const r = await client.query(
        'INSERT INTO users (email, password_hash, role_id) VALUES ($1, $2, $3) RETURNING id',
        [email, sha256('ZzTest123!'), roleId],
      );
      track('users', r.rows[0].id);
      return r.rows[0].id;
    };

    const student = async (email, studentIdNo, courseId, admissionNo) => {
      const uid = await user(email, studentRoleId);
      const r = await client.query(
        `INSERT INTO students (user_id, student_id_no, admission_no, course_id, quota_id, batch_id, student_type)
         VALUES ($1, $2, $3, $4, $5, $6, 'hosteller') RETURNING id`,
        [uid, studentIdNo, admissionNo, courseId, quotaId, batchId],
      );
      track('students', r.rows[0].id);
      return r.rows[0].id;
    };
    const studentA = await student('zztest.student.a@iqacverify.local', 'ZZSTUA001', courseA, 'ZZADMA001');
    const studentB = await student('zztest.student.b@iqacverify.local', 'ZZSTUB001', courseB, 'ZZADMB001');

    const faculty = async (email, departmentId, first, last) => {
      const uid = await user(email, facultyRoleId);
      const r = await client.query(
        `INSERT INTO faculty (user_id, first_name, last_name, designation, department_id)
         VALUES ($1, $2, $3, 'Assistant Professor', $4) RETURNING id`,
        [uid, first, last, departmentId],
      );
      track('faculty', r.rows[0].id);
      return r.rows[0].id;
    };
    const facultyA = await faculty('zztest.faculty.a@iqacverify.local', deptA, 'ZZ', 'FacultyA');
    const facultyB = await faculty('zztest.faculty.b@iqacverify.local', deptB, 'ZZ', 'FacultyB');

    const pub = async (facultyId, title, venue, citations) => {
      const r = await client.query(
        `INSERT INTO faculty_publications (faculty_id, title, type, venue, citation_count)
         VALUES ($1, $2, 'journal', $3, $4) RETURNING id`,
        [facultyId, title, venue, citations],
      );
      track('faculty_publications', r.rows[0].id);
      return r.rows[0].id;
    };
    await pub(facultyA, 'ZZ Paper One', 'IEEE Access', 10);
    await pub(facultyB, 'ZZ Paper Two', 'IEEE Access', 5);
    await pub(facultyB, 'ZZ Paper Three', 'Springer LNNS', 3);

    const teamR = await client.query(
      "INSERT INTO sports_teams (name) VALUES ('ZZ Test Team') RETURNING id",
    );
    const teamId = teamR.rows[0].id;
    track('sports_teams', teamId);

    const achievement = async (fields) => {
      const r = await client.query(
        `INSERT INTO sports_achievements (team_id, athlete_student_id, event_name, result, achievement_date, level)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [fields.team_id ?? null, fields.athlete_student_id ?? null, fields.event_name, fields.result, fields.date, fields.level ?? null],
      );
      track('sports_achievements', r.rows[0].id);
      return r.rows[0].id;
    };
    await achievement({ athlete_student_id: studentA, event_name: 'ZZ State Meet', result: 'Winner', date: '2026-02-01', level: 'State' });
    await achievement({ athlete_student_id: studentB, event_name: 'ZZ State Meet', result: 'Runner-up', date: '2026-02-02', level: 'State' });
    await achievement({ team_id: teamId, event_name: 'ZZ National Relay', result: 'Qualified', date: '2026-03-01', level: 'National' });

    const iqacUserId = await user('zztest.iqac.verify@iqacverify.local', iqacRoleId);

    await client.query('COMMIT');

    manifest.iqacLogin = { email: 'zztest.iqac.verify@iqacverify.local', password: 'ZzTest123!' };
    console.log(JSON.stringify(manifest, null, 2));
    require('fs').writeFileSync('_zzseed_manifest.json', JSON.stringify(manifest, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('SEED FAILED, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
