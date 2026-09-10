require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('./generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');

(async () => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const q = async (sql) => {
    for (let i = 0; i < 3; i++) {
      try { return await prisma.$queryRawUnsafe(sql); }
      catch (e) { if (i === 2 || !String(e.message).includes('ETIMEDOUT')) throw e; }
    }
  };

  const tables = [
    'sports_athlete_profiles','project_team_members','project_teams','project_join_requests',
    'campus_outing_requests','malpractice_incidents','medical_visits','main_gate_in_out_ledger',
    'hostel_night_attendance','seating_arrangements','sports_fitness_tests','sports_injuries',
    'sports_od_squad_members','sports_trials','od_teams','od_team_members','hostel_quit_requests',
    'photocopy_requests',
  ];

  for (const t of tables) {
    const sql2 = `
      SELECT s.class_id,
             COUNT(*) AS n_rows,
             COUNT(DISTINCT tt.student_id) AS n_distinct_students
      FROM students s
      JOIN ${t} tt ON tt.student_id = s.id
      WHERE s.class_id IN (1,2,3,8,9,4,5,10,11,6,7,12,13)
      GROUP BY s.class_id
      ORDER BY s.class_id;
    `;
    try {
      const res = await q(sql2);
      console.log(`=== ${t} ===`);
      console.log(JSON.stringify(res, (k,v)=>typeof v==='bigint'?Number(v):v));
    } catch (e) {
      console.log(`=== ${t} ERROR: ${e.message.split('\n')[0]} ===`);
    }
  }

  // placement drives: which courses/departments are eligible? check drive count and whether AIDS students appear at all in any drive
  console.log('=== placement_drives total count ===');
  console.log(JSON.stringify(await q('SELECT count(*) FROM placement_drives'), (k,v)=>typeof v==='bigint'?Number(v):v));

  await prisma.$disconnect();
})();
