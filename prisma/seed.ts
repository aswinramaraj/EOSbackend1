/**
 * EOS Backend – Database Seed Script
 *
 * Creates all 19 roles + one test user per role.
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
  { name: 'principal',            description: 'College Principal' },
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
  { name: 'gate_warden',          description: 'Main Gate Watch / Hostel Warden' },
  { name: 'media_room',           description: 'Media Room' },
  { name: 'academic_coordinator', description: 'Academic Co-ordinator' },
  { name: 'alumni',               description: 'Alumni' },
  { name: 'edc_coordinator',      description: 'EDC Coordinator' },
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

  // 4. Give the HR Payroll test user a faculty row, same reasoning as step 3
  // above — HR & Payroll staff have their own faculty row too (same table,
  // same faculty_daily_attendance/payslip_requests/appraisal_requests
  // sources as any other faculty member's self-service data), so without
  // this row the HR test account 404s on every "my own" endpoint that
  // resolves faculty.user_id, even for a valid HR Payroll JWT.
  console.log('\n💼  Ensuring hr_payroll@eos.test has a faculty profile...');

  const hrPayrollUser = await (prisma as any).users.findUnique({ where: { email: 'hr_payroll@eos.test' } });
  const existingHrPayrollFaculty = hrPayrollUser
    ? await (prisma as any).faculty.findUnique({ where: { user_id: hrPayrollUser.id } })
    : null;

  if (existingHrPayrollFaculty) {
    console.log(`   ✅  Already exists: faculty.id=${existingHrPayrollFaculty.id}, department_id=${existingHrPayrollFaculty.department_id}`);
  } else if (hrPayrollUser) {
    const firstDepartment = await (prisma as any).departments.findFirst({ orderBy: { id: 'asc' } });
    if (firstDepartment) {
      const hrPayrollFaculty = await (prisma as any).faculty.create({
        data: {
          user_id: hrPayrollUser.id,
          first_name: 'Test',
          last_name: 'HR Payroll',
          designation: 'HR & Payroll Executive',
          department_id: firstDepartment.id,
          status: 'active',
        },
      });
      console.log(`   ✅  Created: faculty.id=${hrPayrollFaculty.id}, department_id=${hrPayrollFaculty.department_id}`);
    } else {
      console.log('   ⚠️  No departments exist yet — skipped (run this seed again after departments are created).');
    }
  }

  // 5. Link the Parent test user to a real student, same reasoning as steps
  // 3-4 above — every /me/children* endpoint resolves the caller's children
  // via parent_student_mapping (parent_user_id -> student_id), so without a
  // mapping row the Parent test account only ever sees an empty child list
  // and can never reach the child-scoped attendance/performance/fees
  // endpoints, even for a valid Parent JWT.
  console.log('\n👨‍👩‍👧  Ensuring parent@eos.test has a linked child...');

  const parentUser = await (prisma as any).users.findUnique({ where: { email: 'parent@eos.test' } });
  const existingParentMapping = parentUser
    ? await (prisma as any).parent_student_mapping.findFirst({ where: { parent_user_id: parentUser.id } })
    : null;

  if (existingParentMapping) {
    console.log(`   ✅  Already exists: mapping.id=${existingParentMapping.id}, student_id=${existingParentMapping.student_id}`);
  } else if (parentUser) {
    const firstStudent = await (prisma as any).students.findFirst({ orderBy: { id: 'asc' } });
    if (firstStudent) {
      const mapping = await (prisma as any).parent_student_mapping.create({
        data: {
          parent_user_id: parentUser.id,
          student_id: firstStudent.id,
          relationship: 'mother',
        },
      });
      console.log(`   ✅  Created: mapping.id=${mapping.id}, student_id=${mapping.student_id}`);
    } else {
      console.log('   ⚠️  No students exist yet — skipped (run this seed again after students are created).');
    }
  }

  // 6. Print credentials table
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
