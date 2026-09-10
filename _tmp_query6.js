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
  const p = async (sql) => JSON.stringify(await q(sql), (k,v)=>typeof v==='bigint'?Number(v):v, 2);

  console.log('=== AIDS subjects (class 4,5,10,11) ===');
  console.log(await p(`SELECT DISTINCT subject_id FROM lms_notes WHERE class_id IN (4,5,10,11) ORDER BY subject_id`));

  console.log('=== lms_folders for AIDS subjects (any exist?) ===');
  console.log(await p(`SELECT * FROM lms_folders WHERE subject_id IN (SELECT DISTINCT subject_id FROM lms_notes WHERE class_id IN (4,5,10,11))`));

  console.log('=== faculty_id=8 is valid AIDS faculty? ===');
  console.log(await p(`SELECT id, user_id, department_id FROM faculty WHERE id=8`));

  console.log('=== transport_routes / stages / buses / fee_structures referenced (generic, campus-wide?) ===');
  console.log(await p(`SELECT id, route_name FROM transport_routes WHERE id=1`));
  console.log(await p(`SELECT id, name FROM transport_stages WHERE id IN (1,3)`));
  console.log(await p(`SELECT id FROM buses WHERE id=3`));
  console.log(await p(`SELECT id, name, department_id FROM fee_structures WHERE id=4`));

  console.log('=== bonafide reasons full list ===');
  console.log(await p(`SELECT * FROM bonafide_reasons`));

  console.log('=== hostel_rooms 2,62,4,64,5,65 (AIDS ones) - hostel_id ===');
  console.log(await p(`SELECT id, room_number, hostel_id FROM hostel_rooms WHERE id IN (2,62,4,64,5,65)`));

  await prisma.$disconnect();
})();
