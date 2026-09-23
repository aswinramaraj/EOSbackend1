/**
 * Splits HOD + Subject-Handling-Faculty duties currently combined on one
 * login into two separate logins for the same real person, per explicit
 * user request: HOD accounts should be HOD-only; any subject/advisor
 * teaching duty they also hold moves to a NEW dedicated faculty-only
 * account (same person, same department, new email).
 *
 * Only touches real @sece.ac.in HOD accounts (not the synthetic
 * cse.hodfaculty.test@erp.test account, which is deliberately built to
 * test the combined-responsibility case and should keep demonstrating it).
 *
 * Idempotent: safe to rerun (upserts the new user/faculty by email,
 * re-pointing is a plain UPDATE so a rerun is a no-op once already moved).
 *
 * Run: npx ts-node prisma/split-hod-faculty-logins.ts
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any) as any;

const TEST_PASSWORD = 'EOS@test123';
const PASSWORD_HASH = crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');
const PLAIN_PROFESSOR_DESIGNATION_ID = 57; // "Professor" - not "& Head"

function slugifyName(firstName: string, lastName: string): string {
  const raw = `${firstName} ${lastName}`.toLowerCase();
  return raw
    .replace(/[^a-z\s]/g, '') // drop dots/initials punctuation
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('.');
}

async function main() {
  console.log('=== Splitting HOD/Faculty logins ===\n');

  const facultyRoleId = (await prisma.roles.findUniqueOrThrow({ where: { name: 'faculty' } })).id;

  const hodFaculty = await prisma.faculty.findMany({
    where: {
      users: { email: { endsWith: '@sece.ac.in' }, roles: { name: 'hod' } },
    },
    select: {
      id: true,
      first_name: true,
      last_name: true,
      department_id: true,
      user_id: true,
      users: { select: { email: true } },
    },
  });

  for (const hod of hodFaculty) {
    const subjectMappings = await prisma.faculty_subject_class_mapping.findMany({ where: { faculty_id: hod.id } });
    const mentorRows = await prisma.class_mentors.findMany({ where: { faculty_id: hod.id } });

    if (subjectMappings.length === 0 && mentorRows.length === 0) {
      console.log(`- ${hod.users.email}: no faculty duties to split, skipping`);
      continue;
    }

    const slug = slugifyName(hod.first_name, hod.last_name);
    const newEmail = `${slug}.faculty@sece.ac.in`;

    const newUser = await prisma.users.upsert({
      where: { email: newEmail },
      update: {},
      create: { email: newEmail, password_hash: PASSWORD_HASH, role_id: facultyRoleId, status: 'active' },
    });

    let newFaculty = await prisma.faculty.findUnique({ where: { user_id: newUser.id } });
    if (!newFaculty) {
      newFaculty = await prisma.faculty.create({
        data: {
          user_id: newUser.id,
          first_name: hod.first_name,
          last_name: hod.last_name,
          designation: 'Professor',
          designation_id: PLAIN_PROFESSOR_DESIGNATION_ID,
          department_id: hod.department_id,
          staff_code: `FAC${hod.id}`,
          status: 'active',
          is_mentor: mentorRows.length > 0,
        },
      });
    }

    const movedSubjects = await prisma.faculty_subject_class_mapping.updateMany({
      where: { faculty_id: hod.id },
      data: { faculty_id: newFaculty.id },
    });
    const movedMentors = await prisma.class_mentors.updateMany({
      where: { faculty_id: hod.id },
      data: { faculty_id: newFaculty.id },
    });

    console.log(
      `- ${hod.users.email} (HOD) -> ${newEmail} (faculty): moved ${movedSubjects.count} subject mapping(s), ${movedMentors.count} advisor mapping(s)`,
    );
  }

  console.log('\n=== Done ===');
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
