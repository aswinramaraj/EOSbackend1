import 'dotenv/config';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });

async function run() {
  const client = await pool.connect();
  try {
    const log = (label: string, rows: any[]) => {
      console.log(`\n=== ${label} (${rows.length}) ===`);
      console.table(rows);
    };

    log(
      'student 20887 basics',
      (
        await client.query(
          `SELECT s.id, s.student_id_no, s.roll_no, s.register_no, s.gender, s.student_type, s.class_id, s.quota_id, s.user_id,
                  c.section, c.current_semester, c.batch_id, c.department_id, u.email
           FROM students s JOIN classes c ON c.id = s.class_id JOIN users u ON u.id = s.user_id
           WHERE s.id = 20887`,
        )
      ).rows,
    );

    log(
      'existing data counts for 20887',
      (
        await client.query(`
          SELECT
            (SELECT count(*) FROM attendance_records WHERE student_id=20887) AS attendance,
            (SELECT count(*) FROM exam_marks WHERE student_id=20887) AS exam_marks,
            (SELECT count(*) FROM student_fee_demand_mapping WHERE student_id=20887) AS fee_demands,
            (SELECT count(*) FROM fee_payments fp JOIN student_fee_demand_mapping d ON d.id=fp.student_fee_demand_mapping_id WHERE d.student_id=20887) AS fee_payments,
            (SELECT count(*) FROM student_hostel_mapping WHERE student_id=20887) AS hostel_mapping,
            (SELECT count(*) FROM book_borrow_records WHERE student_id=20887) AS library,
            (SELECT count(*) FROM od_team_members WHERE student_id=20887) AS od,
            (SELECT count(*) FROM student_leaves WHERE student_id=20887) AS leaves,
            (SELECT count(*) FROM bonafide_requests WHERE student_id=20887) AS bonafide,
            (SELECT count(*) FROM student_no_due_status WHERE student_id=20887) AS no_due,
            (SELECT count(*) FROM student_assignment_status WHERE student_id=20887) AS assignment_status,
            (SELECT count(*) FROM medical_appointments WHERE student_id=20887) AS medical
        `)
      ).rows,
    );

    log(
      'exam_subject_mapping for class 1233 by semester/exam_type',
      (
        await client.query(`
          SELECT ex.semester, et.name AS exam_type, et.category, count(*) AS mapping_count,
                 min(esm.id) AS sample_mapping_id, min(em.max_marks) AS sample_max_marks
          FROM exam_subject_mapping esm
          JOIN exams ex ON ex.id = esm.exam_id
          JOIN exam_types et ON et.id = ex.exam_type_id
          LEFT JOIN exam_marks em ON em.exam_subject_mapping_id = esm.id
          WHERE esm.class_id = 1233
          GROUP BY ex.semester, et.name, et.category
          ORDER BY ex.semester, et.category DESC, et.name
        `)
      ).rows,
    );

    log(
      'exam_subject_mapping detail for class 1233',
      (
        await client.query(`
          SELECT esm.id AS mapping_id, ex.semester, et.name AS exam_type, et.category, sub.id AS subject_id, sub.name AS subject_name, sub.subject_code, sub.credits
          FROM exam_subject_mapping esm
          JOIN exams ex ON ex.id = esm.exam_id
          JOIN exam_types et ON et.id = ex.exam_type_id
          JOIN subjects sub ON sub.id = esm.subject_id
          WHERE esm.class_id = 1233
          ORDER BY ex.semester, et.category DESC, et.name, sub.name
        `)
      ).rows,
    );

    log(
      'existing exam_marks for other students in class 1233 (sample, to check credits/realistic ranges)',
      (
        await client.query(`
          SELECT em.exam_subject_mapping_id, em.student_id, em.marks_obtained, em.max_marks, em.is_absent
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          WHERE esm.class_id = 1233
          LIMIT 15
        `)
      ).rows,
    );

    log(
      'fee_structures / demand for class 1233 students (sample)',
      (
        await client.query(`
          SELECT d.id AS demand_id, d.student_id, d.fee_structure_id, d.academic_year, d.semester, d.total_amount, fs.name AS structure_name
          FROM student_fee_demand_mapping d
          JOIN fee_structures fs ON fs.id = d.fee_structure_id
          JOIN students s ON s.id = d.student_id
          WHERE s.class_id = 1233
          ORDER BY d.semester
          LIMIT 20
        `)
      ).rows,
    );

    log(
      'fee_structure_items columns',
      (
        await client.query(`
          SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'fee_structure_items'
        `)
      ).rows,
    );

    log(
      'fee_structure_items sample',
      (
        await client.query(`
          SELECT * FROM fee_structure_items
          WHERE fee_structure_id = 43
          LIMIT 20
        `)
      ).rows,
    );

    log(
      'abinav (20887) full exam_marks list',
      (
        await client.query(`
          SELECT em.exam_subject_mapping_id, esm.subject_id, sub.name, et.name AS exam_type, em.marks_obtained, em.max_marks
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN subjects sub ON sub.id = esm.subject_id
          JOIN exams ex ON ex.id = esm.exam_id
          JOIN exam_types et ON et.id = ex.exam_type_id
          WHERE em.student_id = 20887
          ORDER BY sub.name, et.name
        `)
      ).rows,
    );

    log(
      'student_hostel_mapping current state (all rows, room 1799 + abinav)',
      (
        await client.query(`
          SELECT * FROM student_hostel_mapping WHERE student_id = 20887 OR room_id = 1799
        `)
      ).rows,
    );

    log(
      'any exam_subject_mapping at all for semesters 1-6, any class (checking if ANY historical semester data exists anywhere)',
      (
        await client.query(`
          SELECT ex.semester, count(*) FROM exam_subject_mapping esm JOIN exams ex ON ex.id=esm.exam_id
          WHERE ex.semester < 7 GROUP BY ex.semester ORDER BY ex.semester
        `)
      ).rows,
    );

    log(
      'assignments for class 1233',
      (
        await client.query(`
          SELECT id, class_id, subject_id, faculty_id, academic_year, semester, sequence_no, title, due_date, max_marks, task_type
          FROM assignments WHERE class_id = 1233
        `)
      ).rows,
    );

    log(
      'hostel_rooms columns',
      (
        await client.query(`SELECT column_name, data_type FROM information_schema.columns WHERE table_name='hostel_rooms'`)
      ).rows,
    );

    log(
      'hostel room 1799 raw row',
      (await client.query(`SELECT * FROM hostel_rooms WHERE id = 1799`)).rows,
    );

    log('hostels row for that room', (await client.query(`SELECT h.* FROM hostels h JOIN hostel_rooms hr ON hr.hostel_id = h.id WHERE hr.id = 1799`)).rows);

    log(
      'other classes for batch_id 54 (same batch as abinav, any semester)',
      (
        await client.query(`
          SELECT id, section, current_semester, department_id, batch_id FROM classes WHERE batch_id = 54 ORDER BY current_semester
        `)
      ).rows,
    );

    log(
      'exam_subject_mapping semesters present, grouped by class_id, for classes sharing department_id 82',
      (
        await client.query(`
          SELECT esm.class_id, ex.semester, count(*)
          FROM exam_subject_mapping esm
          JOIN exams ex ON ex.id = esm.exam_id
          JOIN classes c ON c.id = esm.class_id
          WHERE c.department_id = 82
          GROUP BY esm.class_id, ex.semester
          ORDER BY esm.class_id, ex.semester
        `)
      ).rows,
    );

    log(
      'library books sample (real book_ids)',
      (await client.query(`SELECT id, title, author FROM books LIMIT 10`)).rows,
    );

    log(
      'medical_appointment_windows columns',
      (
        await client.query(
          `SELECT column_name, data_type FROM information_schema.columns WHERE table_name='medical_appointment_windows'`,
        )
      ).rows,
    );

    log(
      'sections for classes 1237-1248 (department 82, sem 1/3/5)',
      (await client.query(`SELECT id, section, current_semester FROM classes WHERE id IN (1237,1238,1239,1240,1241,1242,1243,1244,1245,1246,1247,1248) ORDER BY current_semester, section`)).rows,
    );

    log(
      'exam_subject_mapping detail for class 1237 (presumed sem5 section A)',
      (
        await client.query(`
          SELECT esm.id AS mapping_id, ex.semester, et.name AS exam_type, sub.id AS subject_id, sub.name AS subject_name, em2.max_marks
          FROM exam_subject_mapping esm
          JOIN exams ex ON ex.id = esm.exam_id
          JOIN exam_types et ON et.id = ex.exam_type_id
          JOIN subjects sub ON sub.id = esm.subject_id
          LEFT JOIN (SELECT DISTINCT ON (exam_subject_mapping_id) exam_subject_mapping_id, max_marks FROM exam_marks) em2 ON em2.exam_subject_mapping_id = esm.id
          WHERE esm.class_id = 1237
          ORDER BY et.name, sub.name
        `)
      ).rows,
    );

    log(
      'exam_subject_mapping detail for class 1241 (presumed sem3 section A)',
      (
        await client.query(`
          SELECT esm.id AS mapping_id, ex.semester, et.name AS exam_type, sub.id AS subject_id, sub.name AS subject_name, em2.max_marks
          FROM exam_subject_mapping esm
          JOIN exams ex ON ex.id = esm.exam_id
          JOIN exam_types et ON et.id = ex.exam_type_id
          JOIN subjects sub ON sub.id = esm.subject_id
          LEFT JOIN (SELECT DISTINCT ON (exam_subject_mapping_id) exam_subject_mapping_id, max_marks FROM exam_marks) em2 ON em2.exam_subject_mapping_id = esm.id
          WHERE esm.class_id = 1241
          ORDER BY et.name, sub.name
        `)
      ).rows,
    );

    log(
      'exam_subject_mapping detail for class 1245 (presumed sem1 section A)',
      (
        await client.query(`
          SELECT esm.id AS mapping_id, ex.semester, et.name AS exam_type, sub.id AS subject_id, sub.name AS subject_name, em2.max_marks
          FROM exam_subject_mapping esm
          JOIN exams ex ON ex.id = esm.exam_id
          JOIN exam_types et ON et.id = ex.exam_type_id
          JOIN subjects sub ON sub.id = esm.subject_id
          LEFT JOIN (SELECT DISTINCT ON (exam_subject_mapping_id) exam_subject_mapping_id, max_marks FROM exam_marks) em2 ON em2.exam_subject_mapping_id = esm.id
          WHERE esm.class_id = 1245
          ORDER BY et.name, sub.name
        `)
      ).rows,
    );

    log(
      'do any students already have exam_marks under class 1237/1241/1245, and are those students currently in class 1233-1236 (same batch progressed) or a different population?',
      (
        await client.query(`
          SELECT esm.class_id, em.student_id, s.class_id AS students_current_class_id, count(*) AS mark_rows
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN students s ON s.id = em.student_id
          WHERE esm.class_id IN (1237,1241,1245)
          GROUP BY esm.class_id, em.student_id, s.class_id
          ORDER BY esm.class_id, em.student_id
          LIMIT 20
        `)
      ).rows,
    );

    log(
      'bonafide_reasons columns',
      (await client.query(`SELECT column_name FROM information_schema.columns WHERE table_name='bonafide_reasons'`)).rows,
    );
    log(
      'bonafide_reasons',
      (await client.query(`SELECT * FROM bonafide_reasons LIMIT 10`)).rows,
    );

    log(
      'faculty for class 1233 (faculty_subject_class_mapping)',
      (
        await client.query(`
          SELECT fscm.faculty_id, f.first_name, f.last_name, fscm.subject_id, sub.name AS subject_name
          FROM faculty_subject_class_mapping fscm
          JOIN faculty f ON f.id = fscm.faculty_id
          JOIN subjects sub ON sub.id = fscm.subject_id
          WHERE fscm.class_id = 1233
        `)
      ).rows,
    );

    log(
      'wallet for 20887',
      (
        await client.query(
          `SELECT w.id, w.user_id, w.balance FROM wallets w JOIN students s ON s.user_id = w.user_id WHERE s.id = 20887`,
        )
      ).rows,
    );
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
