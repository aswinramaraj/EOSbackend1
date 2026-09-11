const { Client } = require('pg');
require('dotenv').config();
const fs = require('fs');

const MANIFEST_PATH = 'C:/Users/shona/AppData/Local/Temp/claude/c--Users-shona-OneDrive-Documents-EOS1/2b04a526-ac1c-4b0b-81b0-7866bb112dfc/scratchpad/iqac_verify_manifest.json';
const PW_HASH = '1e9b38de300be8453122d0138c5854010c9dc0587c53ceab4d9bcd14db882816';

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const m = { tables: {} };
  const track = (table, id) => {
    if (!m.tables[table]) m.tables[table] = [];
    m.tables[table].push(id);
  };
  const q = async (sql, params) => (await client.query(sql, params)).rows;

  try {
    await client.query('BEGIN');
    const roleRow = async (name) => (await q('SELECT id FROM roles WHERE name = $1', [name]))[0];
    const iqacRole = await roleRow('iqac');
    const facultyRole = await roleRow('faculty');
    const studentRole = await roleRow('student');
    if (!iqacRole || !facultyRole || !studentRole) throw new Error('Missing expected role rows');

    const [dept1] = await q(`INSERT INTO departments (name, code) VALUES ($1,$2) RETURNING id`, ['ZZTEST Computer Science', 'ZZTCS']);
    track('departments', dept1.id);
    const [dept2] = await q(`INSERT INTO departments (name, code) VALUES ($1,$2) RETURNING id`, ['ZZTEST AI and Data Science', 'ZZTAD']);
    track('departments', dept2.id);

    const [batch1] = await q(`INSERT INTO batches (name, start_year, end_year) VALUES ($1,$2,$3) RETURNING id`, ['ZZTEST-2023-2027', 2023, 2027]);
    track('batches', batch1.id);

    const [course1] = await q(
      `INSERT INTO courses (name, code, department_id, accreditation_status, accreditation_valid_until) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      ['ZZTEST B.E. Computer Science', 'ZZTCS101', dept1.id, 'NBA Tier-1', '2028-06-30'],
    );
    track('courses', course1.id);
    const [course2] = await q(`INSERT INTO courses (name, code, department_id) VALUES ($1,$2,$3) RETURNING id`, ['ZZTEST B.Tech AI and Data Science', 'ZZTAD101', dept2.id]);
    track('courses', course2.id);

    const [quota1] = await q(`INSERT INTO quotas (name) VALUES ($1) RETURNING id`, ['ZZTEST Quota']);
    track('quotas', quota1.id);

    const [class1] = await q(
      `INSERT INTO classes (batch_id, department_id, course_id, section, current_semester) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [batch1.id, dept1.id, course1.id, 'A', 5],
    );
    track('classes', class1.id);
    const [class2] = await q(
      `INSERT INTO classes (batch_id, department_id, course_id, section, current_semester) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [batch1.id, dept2.id, course2.id, 'A', 5],
    );
    track('classes', class2.id);

    const [subj1] = await q(
      `INSERT INTO subjects (name, subject_code, department_id, credits, semester) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      ['ZZTEST Data Structures', 'ZZT501', dept1.id, 4, 5],
    );
    track('subjects', subj1.id);
    const [subj2] = await q(
      `INSERT INTO subjects (name, subject_code, department_id, credits, semester) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      ['ZZTEST Deep Learning', 'ZZT502', dept2.id, 4, 5],
    );
    track('subjects', subj2.id);

    const [iqacUser] = await q(
      `INSERT INTO users (email, password_hash, role_id, status) VALUES ($1,$2,$3,'active') RETURNING id`,
      ['zztest.iqac@iqacverify.local', PW_HASH, iqacRole.id],
    );
    track('users', iqacUser.id);

    async function makeFaculty(email, firstName, lastName, deptId, staffCode) {
      const [u] = await q(`INSERT INTO users (email, password_hash, role_id, status) VALUES ($1,$2,$3,'active') RETURNING id`, [email, PW_HASH, facultyRole.id]);
      track('users', u.id);
      const [f] = await q(
        `INSERT INTO faculty (user_id, first_name, last_name, designation, department_id, date_of_joining, qualification, staff_code, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'active') RETURNING id`,
        [u.id, firstName, lastName, 'Assistant Professor', deptId, '2019-06-01', 'Ph.D.', staffCode],
      );
      track('faculty', f.id);
      return f.id;
    }
    const fac1 = await makeFaculty('zztest.faculty1@iqacverify.local', 'Zeta', 'TestFacultyOne', dept1.id, 'ZZT-FAC-001');
    const fac2 = await makeFaculty('zztest.faculty2@iqacverify.local', 'Zeta', 'TestFacultyTwo', dept2.id, 'ZZT-FAC-002');

    const [cm1] = await q(`INSERT INTO class_mentors (class_id, faculty_id, academic_year) VALUES ($1,$2,$3) RETURNING id`, [class1.id, fac1, '2026-2027']);
    track('class_mentors', cm1.id);
    const [cm2] = await q(`INSERT INTO class_mentors (class_id, faculty_id, academic_year) VALUES ($1,$2,$3) RETURNING id`, [class2.id, fac2, '2026-2027']);
    track('class_mentors', cm2.id);

    async function makeStudent(email, idNo, rollNo, registerNo, courseId, classId, deptId, mentorFacultyId) {
      const [u] = await q(`INSERT INTO users (email, password_hash, role_id, status) VALUES ($1,$2,$3,'active') RETURNING id`, [email, PW_HASH, studentRole.id]);
      track('users', u.id);
      const [s] = await q(
        `INSERT INTO students (user_id, student_id_no, roll_no, register_no, course_id, quota_id, class_id, batch_id, admission_date, student_type, dayscholar_mode, status, mentor_faculty_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'dayscholar','transport','active',$10) RETURNING id`,
        [u.id, idNo, rollNo, registerNo, courseId, quota1.id, classId, batch1.id, '2023-08-01', mentorFacultyId],
      );
      track('students', s.id);
      return s.id;
    }
    const stu1 = await makeStudent('zztest.student1@iqacverify.local', 'ZZT23CS001', '23ZZTCS01', 'REGZZT001', course1.id, class1.id, dept1.id, fac1);
    const stu2 = await makeStudent('zztest.student2@iqacverify.local', 'ZZT23CS002', '23ZZTCS02', 'REGZZT002', course1.id, class1.id, dept1.id, fac1);
    const stu3 = await makeStudent('zztest.student3@iqacverify.local', 'ZZT23AD001', '23ZZTAD01', 'REGZZT003', course2.id, class2.id, dept2.id, fac2);
    const stu4 = await makeStudent('zztest.student4@iqacverify.local', 'ZZT23AD002', '23ZZTAD02', 'REGZZT004', course2.id, class2.id, dept2.id, fac2);

    const attDates = ['2026-07-10', '2026-07-11', '2026-08-10', '2026-08-11'];
    for (const [i, stuId] of [stu1, stu2, stu3, stu4].entries()) {
      for (const [j, date] of attDates.entries()) {
        const status = (i + j) % 4 === 0 ? 'absent' : 'present';
        const classId = i < 2 ? class1.id : class2.id;
        const [r] = await q(
          `INSERT INTO attendance_records (student_id, class_id, subject_id, attendance_date, status, marked_by_user_id, is_published)
           VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
          [stuId, classId, i < 2 ? subj1.id : subj2.id, date, status, iqacUser.id],
        );
        track('attendance_records', r.id);
      }
    }
    for (const [i, stuId] of [stu1, stu2, stu3, stu4].entries()) {
      const [r] = await q(
        `INSERT INTO attendance_records (student_id, class_id, subject_id, attendance_date, status, marked_by_user_id, is_published)
         VALUES ($1,$2,$3,$4,$5,$6,true) RETURNING id`,
        [stuId, i < 2 ? class1.id : class2.id, i < 2 ? subj1.id : subj2.id, '2025-07-10', 'present', iqacUser.id],
      );
      track('attendance_records', r.id);
    }

    const bands = [
      ['O', 91, 10, true, 1], ['A+', 81, 9, true, 2], ['A', 71, 8, true, 3],
      ['B+', 61, 7, true, 4], ['B', 51, 6, true, 5], ['C', 40, 5, true, 6], ['U', 0, 0, false, 7],
    ];
    for (const [label, minPct, gp, isPass, order] of bands) {
      const [b] = await q(
        `INSERT INTO grade_bands (grade_label, min_percentage, grade_point, is_pass, display_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [label, minPct, gp, isPass, order],
      );
      track('grade_bands', b.id);
    }

    const [examType] = await q(`INSERT INTO exam_types (name, category, code, is_university) VALUES ($1,'external',$2,true) RETURNING id`, ['ZZTEST University Exam', 'ZZTUNIV']);
    track('exam_types', examType.id);
    const [exam1] = await q(
      `INSERT INTO exams (exam_type_id, batch_id, academic_year, semester, status, title) VALUES ($1,$2,$3,$4,'results_published',$5) RETURNING id`,
      [examType.id, batch1.id, '2026-2027', 5, 'ZZTEST Semester 5 Exam'],
    );
    track('exams', exam1.id);
    const [esm1] = await q(`INSERT INTO exam_subject_mapping (exam_id, class_id, subject_id, is_published) VALUES ($1,$2,$3,true) RETURNING id`, [exam1.id, class1.id, subj1.id]);
    track('exam_subject_mapping', esm1.id);
    const [esm2] = await q(`INSERT INTO exam_subject_mapping (exam_id, class_id, subject_id, is_published) VALUES ($1,$2,$3,true) RETURNING id`, [exam1.id, class2.id, subj2.id]);
    track('exam_subject_mapping', esm2.id);

    const markRows = [[esm1.id, stu1, 78, 100], [esm1.id, stu2, 35, 100], [esm2.id, stu3, 88, 100], [esm2.id, stu4, 92, 100]];
    for (const [mappingId, studentId, obtained, max] of markRows) {
      const [em] = await q(`INSERT INTO exam_marks (exam_subject_mapping_id, student_id, marks_obtained, max_marks, is_absent) VALUES ($1,$2,$3,$4,false) RETURNING id`, [mappingId, studentId, obtained, max]);
      track('exam_marks', em.id);
    }

    const [company1] = await q(`INSERT INTO companies (name) VALUES ($1) RETURNING id`, ['ZZTEST Corp']);
    track('companies', company1.id);
    const [drive1] = await q(
      `INSERT INTO placement_drives (company_id, scheduled_date, status, job_role, package_lpa) VALUES ($1,$2,'completed',$3,$4) RETURNING id`,
      [company1.id, '2026-06-15', 'ZZTEST Software Engineer', 12.5],
    );
    track('placement_drives', drive1.id);
    for (const stuId of [stu1, stu3]) {
      const [app] = await q(`INSERT INTO student_drive_applications (drive_id, student_id, status, offered_package) VALUES ($1,$2,'placed',$3) RETURNING id`, [drive1.id, stuId, 12.5]);
      track('student_drive_applications', app.id);
    }

    for (const [facId, venue, title, citations] of [
      [fac1, 'ZZTEST IEEE Access', 'ZZTEST Paper on Distributed Systems', 4],
      [fac2, 'ZZTEST Springer LNNS', 'ZZTEST Paper on Deep Learning', 2],
    ]) {
      const [p] = await q(`INSERT INTO faculty_publications (faculty_id, title, type, year, venue, citation_count) VALUES ($1,$2,'journal',2026,$3,$4) RETURNING id`, [facId, title, venue, citations]);
      track('faculty_publications', p.id);
    }

    for (const [stuId, event, result, level] of [
      [stu1, 'ZZTEST Athletics Meet', 'First place', 'State'],
      [stu3, 'ZZTEST Athletics Meet', 'Second place', 'State'],
    ]) {
      const [a] = await q(`INSERT INTO sports_achievements (event_name, result, achievement_date, athlete_student_id, level) VALUES ($1,$2,$3,$4,$5) RETURNING id`, [event, result, '2026-03-01', stuId, level]);
      track('sports_achievements', a.id);
    }

    const [crit1] = await q(
      `INSERT INTO nba_criteria (department_id, code, name, max_marks, sort_order) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [dept1.id, 'ZZT-C1', 'ZZTEST Vision, Mission and PEOs', 60, 1],
    );
    track('nba_criteria', crit1.id);
    for (const [label, done] of [['ZZTEST PEO document', true], ['ZZTEST stakeholder minutes', false]]) {
      const [ev] = await q(`INSERT INTO nba_evidence_items (criterion_id, label, done) VALUES ($1,$2,$3) RETURNING id`, [crit1.id, label, done]);
      track('nba_evidence_items', ev.id);
    }

    for (const [key, target] of [['attendance', 90], ['results', 85], ['cgpa', 7.5]]) {
      const [t] = await q(`INSERT INTO iqac_metric_targets (metric_key, academic_year, target_value, set_by_user_id) VALUES ($1,'2026-2027',$2,$3) RETURNING id`, [key, target, iqacUser.id]);
      track('iqac_metric_targets', t.id);
    }

    const [mou1] = await q(`INSERT INTO department_mous (department_id, partner_name, signed_date, status) VALUES ($1,$2,$3,'active') RETURNING id`, [dept1.id, 'ZZTEST Industry Partner', '2026-01-01']);
    track('department_mous', mou1.id);
    const [fund1] = await q(
      `INSERT INTO department_research_funding (department_id, title, funding_agency, sanctioned_amount, status) VALUES ($1,$2,$3,$4,'ongoing') RETURNING id`,
      [dept1.id, 'ZZTEST Research Grant', 'ZZTEST DST', 500000],
    );
    track('department_research_funding', fund1.id);

    const [he1] = await q(
      `INSERT INTO student_higher_education (student_id, preferred_course, preferred_country, preferred_university) VALUES ($1,$2,$3,$4) RETURNING id`,
      [stu2, 'ZZTEST MS Computer Science', 'USA', 'ZZTEST State University'],
    );
    track('student_higher_education', he1.id);
    const [edc1] = await q(
      `INSERT INTO student_entrepreneurship (student_id, business_name, sector, stage, registration_type, is_incubated) VALUES ($1,$2,$3,$4,'proprietorship',true) RETURNING id`,
      [stu4, 'ZZTEST Venture', 'EdTech', 'Prototype'],
    );
    track('student_entrepreneurship', edc1.id);

    const [co1] = await q(`INSERT INTO course_outcomes (subject_id, code, description) VALUES ($1,$2,$3) RETURNING id`, [subj1.id, 'CO1', 'ZZTEST Apply data structure concepts']);
    track('course_outcomes', co1.id);
    const [po1] = await q(`INSERT INTO program_outcomes (department_id, code, description) VALUES ($1,$2,$3) RETURNING id`, [dept1.id, 'PO1', 'ZZTEST Engineering knowledge']);
    track('program_outcomes', po1.id);
    const [oa1] = await q(
      `INSERT INTO outcome_attainments (outcome_type, course_outcome_id, academic_year, direct_value, indirect_value, target_value, attained_value) VALUES ('course',$1,'2026-2027',2.6,2.4,2.8,2.55) RETURNING id`,
      [co1.id],
    );
    track('outcome_attainments', oa1.id);
    const [oa2] = await q(
      `INSERT INTO outcome_attainments (outcome_type, program_outcome_id, academic_year, direct_value, indirect_value, target_value, attained_value) VALUES ('program',$1,'2026-2027',2.5,2.3,2.8,2.45) RETURNING id`,
      [po1.id],
    );
    track('outcome_attainments', oa2.id);

    await client.query('COMMIT');
    m.key_ids = { department1_id: dept1.id, exam1_id: exam1.id, batch1_id: batch1.id, semester: 5, company1_id: company1.id, iqac_login_email: 'zztest.iqac@iqacverify.local', iqac_login_password: 'EOS@test123' };
    fs.writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
    console.log('SEED OK.');
    console.log(JSON.stringify(m.key_ids, null, 2));
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('SEED FAILED, rolled back:', err.message);
    process.exitCode = 1;
  } finally {
    await client.end();
  }
}

main();
