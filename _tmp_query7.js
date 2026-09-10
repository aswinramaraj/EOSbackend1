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

  console.log('=== bonafide reasons full list ===');
  console.log(await p(`SELECT * FROM bonafide_reasons`));

  console.log('=== hostel_rooms AIDS students rooms - hostel_id ===');
  console.log(await p(`SELECT id, room_number, hostel_id FROM hostel_rooms WHERE id IN (2,62,4,64,5,65)`));

  console.log('=== transport_routes/stages/buses/fee_structures columns check ===');
  console.log(await p(`SELECT column_name FROM information_schema.columns WHERE table_name='transport_routes'`));
  console.log(await p(`SELECT * FROM transport_routes WHERE id=1`));
  console.log(await p(`SELECT * FROM fee_structures WHERE id=4`));

  console.log('=== users table check for a couple parent placeholders (to confirm role linking pattern) ===');
  console.log(await p(`SELECT psm.id, psm.parent_user_id, psm.student_id, psm.relationship, u.role_id, u.email, u.full_name FROM parent_student_mapping psm JOIN users u ON u.id = psm.parent_user_id LIMIT 3`));
  console.log(await p(`SELECT id, name FROM roles WHERE name ILIKE '%parent%'`));

  await prisma.$disconnect();
})();
