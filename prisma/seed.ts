/**
 * EOS Backend – Database Seed Script
 *
 * Creates all 18 roles + one test user per role.
 * Password for ALL test users: EOS@test123
 *
 * Run:  npm run seed
 */

import 'dotenv/config';
import crypto from 'node:crypto';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma  = new PrismaClient({ adapter } as any);

const TEST_PASSWORD = 'EOS@test123';
const PASSWORD_HASH = crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');

// ─── All roles ───────────────────────────────────────────────────────────────
const ROLES = [
  { name: 'admin',                description: 'System Administrator – full access' },
  { name: 'hod',                  description: 'Head of Department' },
  { name: 'faculty',              description: 'Teaching Faculty' },
  { name: 'student',              description: 'Student' },
  { name: 'parent',               description: 'Parent / Guardian' },
  { name: 'coe',                  description: 'Controller of Examinations' },
  { name: 'placement',            description: 'Placement Cell' },
  { name: 'library',              description: 'Library Staff' },
  { name: 'billing',              description: 'Billing / Fees Collection' },
  { name: 'hr_payroll',           description: 'HR & Payroll Management' },
  { name: 'finance',              description: 'Finance Team' },
  { name: 'iqac',                 description: 'IQAC – Internal Quality Assurance Cell' },
  { name: 'secretary',            description: 'Department Secretary / IT Infrastructure' },
  { name: 'warden',               description: 'Hostel Warden' },
  { name: 'gate_warden',          description: 'Gate Warden' },
  { name: 'media_room',           description: 'Media Room' },
  { name: 'academic_coordinator', description: 'Academic Co-ordinator' },
  { name: 'alumni',               description: 'Alumni' },
] as const;

async function main() {
  console.log('\n🌱  EOS Backend – Database Seed\n');

  // 1. Upsert all roles
  console.log('📋  Upserting roles...');
  const roleMap: Record<string, number> = {};

  for (const role of ROLES) {
    const r = await (prisma as any).roles.upsert({
      where:  { name: role.name },
      update: { description: role.description },
      create: role,
    });
    roleMap[role.name] = r.id;
    console.log(`   ✅  ${role.name.padEnd(26)} id=${r.id}`);
  }

  // 2. Create one test user per role
  console.log('\n👤  Creating test users...');

  for (const role of ROLES) {
    const email = `${role.name}@eos.test`;
    const u = await (prisma as any).users.upsert({
      where:  { email },
      update: { password_hash: PASSWORD_HASH, role_id: roleMap[role.name] },
      create: {
        email,
        password_hash: PASSWORD_HASH,
        role_id:       roleMap[role.name],
        status:        'active',
      },
    });
    console.log(`   ✅  ${email.padEnd(42)} id=${u.id}`);
  }

  // 3. Give the HoD test user a faculty row.
  // Several HoD-only endpoints (e.g. Class Mentors' department-scope check)
  // resolve the caller's own department via faculty.department_id — there is
  // no other column anywhere in the schema that records which department a
  // user belongs to. Without this row, those checks 404 with "Faculty
  // profile not found for the authenticated user" even for a valid HoD JWT.
  console.log('\n🏫  Ensuring hod@eos.test has a faculty profile...');

  const hodUser = await (prisma as any).users.findUnique({ where: { email: 'hod@eos.test' } });
  const existingHodFaculty = hodUser
    ? await (prisma as any).faculty.findUnique({ where: { user_id: hodUser.id } })
    : null;

  if (existingHodFaculty) {
    console.log(`   ✅  Already exists: faculty.id=${existingHodFaculty.id}, department_id=${existingHodFaculty.department_id}`);
  } else if (hodUser) {
    const firstDepartment = await (prisma as any).departments.findFirst({ orderBy: { id: 'asc' } });
    if (firstDepartment) {
      const hodFaculty = await (prisma as any).faculty.create({
        data: {
          user_id: hodUser.id,
          first_name: 'Test',
          last_name: 'HoD',
          designation: 'Head of Department',
          department_id: firstDepartment.id,
          status: 'active',
        },
      });
      console.log(`   ✅  Created: faculty.id=${hodFaculty.id}, department_id=${hodFaculty.department_id}`);
    } else {
      console.log('   ⚠️  No departments exist yet — skipped (run this seed again after departments are created).');
    }
  }

  // 4. Print credentials table
  const LINE = '═'.repeat(65);
  console.log(`\n${LINE}`);
  console.log('  POSTMAN TEST CREDENTIALS');
  console.log('  Password for every account: EOS@test123');
  console.log(LINE);
  console.log('  Email                                    Role');
  console.log('─'.repeat(65));
  for (const r of ROLES) {
    console.log(`  ${`${r.name}@eos.test`.padEnd(43)}${r.name}`);
  }
  console.log(LINE);
  console.log('\n✅  Seed complete!\n');
}

main()
  .catch((e) => { console.error('❌  Seed failed:', e); process.exit(1); })
  .finally(() => (prisma as any).$disconnect());
