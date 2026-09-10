require('dotenv').config({ path: '.env' });
const { PrismaClient } = require('./generated/prisma/client');
const { PrismaPg } = require('@prisma/adapter-pg');
(async () => {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });
  const q = async (sql) => JSON.stringify(await prisma.$queryRawUnsafe(sql), (k,v)=>typeof v==='bigint'?Number(v):v, 2);
  console.log(await q('SELECT id, name, code, department_id FROM courses WHERE department_id IN (1,2,3) ORDER BY department_id'));
  console.log(await q('SELECT course_id, class_id, count(*) FROM students WHERE course_id IN (SELECT id FROM courses WHERE department_id=1) GROUP BY course_id, class_id ORDER BY course_id, class_id'));
  console.log(await q('SELECT id, section, batch_id, current_semester, course_id FROM classes WHERE course_id IN (SELECT id FROM courses WHERE department_id IN (1,3)) ORDER BY course_id, id'));
  await prisma.$disconnect();
})();
