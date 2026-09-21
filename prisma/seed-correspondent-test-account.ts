// One-off, additive test-data script — NOT part of the application backend
// code. Creates the 'correspondent' role (new, see ROLES.CORRESPONDENT in
// roles.constant.ts) and one test account for it, following the same
// email/password convention as the other real sece.ac.in test accounts
// (see reference memory: universal password EOS@test123, sha256 hex hash —
// see AuthService.login's own hashing). Correspondent is an institution-wide
// role like Principal/HR Payroll — no faculty/non_teaching_staff row needed.
import 'dotenv/config';
import crypto from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const TEST_PASSWORD = 'EOS@test123';
const PASSWORD_HASH = crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');

async function main() {
  const role = await prisma.roles.upsert({
    where: { name: 'correspondent' },
    update: { description: 'Correspondent / Management' },
    create: { name: 'correspondent', description: 'Correspondent / Management' },
  });
  console.log(`Role 'correspondent' id=${role.id}`);

  const email = 'correspondent@sece.ac.in';
  const user = await prisma.users.upsert({
    where: { email },
    update: { password_hash: PASSWORD_HASH, role_id: role.id, status: 'active' },
    create: {
      email,
      password_hash: PASSWORD_HASH,
      role_id: role.id,
      status: 'active',
    },
  });
  console.log(`User ${email} id=${user.id} role_id=${user.role_id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
