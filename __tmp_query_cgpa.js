require('dotenv').config({ path: 'C:/Users/shona/OneDrive/Documents/EOS1/EOSbackend1/.env' });
const { Client } = require('pg');

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  console.log('--- exam status counts for end-semester-like exam types ---');
  const r1 = await client.query(`
    select et.name as exam_type, e.status, count(*) as n
    from exams e
    join exam_types et on et.id = e.exam_type_id
    where lower(et.name) like '%end semester%' or lower(et.name) like '%university%'
    group by 1,2 order by 1,2
  `);
  console.table(r1.rows);

  console.log('--- overall exam_marks count for semester-exam-type exams, with non-null marks_obtained ---');
  const r2 = await client.query(`
    select et.name as exam_type, e.status,
      count(*) as total_marks_rows,
      count(em.marks_obtained) as non_null_marks
    from exam_marks em
    join exam_subject_mapping esm on esm.id = em.exam_subject_mapping_id
    join exams e on e.id = esm.exam_id
    join exam_types et on et.id = e.exam_type_id
    where lower(et.name) like '%end semester%' or lower(et.name) like '%university%'
    group by 1,2 order by 1,2
  `);
  console.table(r2.rows);

  console.log('--- find a real student with populated end-semester marks + subject credits ---');
  const r3 = await client.query(`
    select em.student_id, s.subject_code, s.name as subject_name, s.credits,
      em.marks_obtained, em.max_marks, e.semester, et.name as exam_type, e.status
    from exam_marks em
    join exam_subject_mapping esm on esm.id = em.exam_subject_mapping_id
    join exams e on e.id = esm.exam_id
    join exam_types et on et.id = e.exam_type_id
    join subjects s on s.id = esm.subject_id
    where (lower(et.name) like '%end semester%' or lower(et.name) like '%university%')
      and em.marks_obtained is not null
      and e.status in ('completed','results_published')
    order by em.student_id, s.subject_code
    limit 20
  `);
  console.table(r3.rows);

  console.log('--- how many distinct students have >=3 subjects of end-sem marks populated (a "full semester" case) ---');
  const r4 = await client.query(`
    select em.student_id, e.semester, count(*) as n_subjects
    from exam_marks em
    join exam_subject_mapping esm on esm.id = em.exam_subject_mapping_id
    join exams e on e.id = esm.exam_id
    join exam_types et on et.id = e.exam_type_id
    where (lower(et.name) like '%end semester%' or lower(et.name) like '%university%')
      and em.marks_obtained is not null
      and e.status in ('completed','results_published')
    group by 1,2
    having count(*) >= 3
    order by n_subjects desc
    limit 10
  `);
  console.table(r4.rows);

  console.log('--- subjects.credits null vs non-null counts ---');
  const r5 = await client.query(`select count(*) total, count(credits) with_credits from subjects`);
  console.table(r5.rows);

  await client.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
