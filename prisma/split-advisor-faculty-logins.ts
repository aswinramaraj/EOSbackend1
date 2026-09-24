/**
 * Same split as split-hod-faculty-logins.ts, extended to Class Advisors:
 * a Class Advisor login should be advisor-only. Any subject-handling
 * duty they also hold moves to a NEW dedicated faculty-only account
 * (same person, same department, new email) - the advisor keeps their
 * original email and class_mentors row untouched.
 *
 * Scale note: 136 of 162 real advisors currently double as subject
 * faculty (the normal real-world pattern) - this touches all of them,
 * per explicit confirmation.
 *
 * Idempotent: safe to rerun.
 *
 * Run: npx ts-node prisma/split-advisor-faculty-logins.ts
 */
import 'dotenv/config';
import * as crypto from 'crypto';
import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter } as any) as any;

const TEST_PASSWORD = 'EOS@test123';
const PASSWORD_HASH = crypto.createHash('sha256').update(TEST_PASSWORD).digest('hex');
const PLAIN_PROFESSOR_DESIGNATION_ID = 59; // "Assistant Professor" - generic default for the split-off account

function slugifyName(firstName: string, lastName: string): string {
  const raw = `${firstName} ${lastName}`.toLowerCase();
  return raw
    .replace(/[^a-z\s]/g, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join('.');
}

async function uniqueFacultyEmail(baseSlug: string, staffId: number): Promise<string> {
  const candidate = `${baseSlug}.faculty@sece.ac.in`;
  const existing = await prisma.users.findUnique({ where: { email: candidate } });
  if (!existing) return candidate;
  // Name collision (common first names) - disambiguate with the source faculty's own id.
  return `${baseSlug}.faculty${staffId}@sece.ac.in`;
}

async function main() {
  console.log('=== Splitting Advisor/Faculty logins ===\n');

  const facultyRoleId = (await prisma.roles.findUniqueOrThrow({ where: { name: 'faculty' } })).id;

  const advisors = await prisma.faculty.findMany({
    where: {
      class_mentors: { some: {} },
      faculty_subject_class_mapping: { some: {} },
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

  console.log(`Found ${advisors.length} advisor(s) also holding subject-handling duty.\n`);

  let done = 0;
  for (const advisor of advisors) {
    try {
      const subjectMappings = await prisma.faculty_subject_class_mapping.findMany({ where: { faculty_id: advisor.id } });
      if (subjectMappings.length === 0) continue;

      const slug = slugifyName(advisor.first_name, advisor.last_name);
      // Always suffix with the source faculty's own id - guaranteed unique,
      // avoids any chance of colliding with an unrelated real account that
      // happens to share the same slugified name (seen in practice: two
      // different real people both named "Harish Anand").
      const newEmail = `${slug}.faculty${advisor.id}@sece.ac.in`;

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
            first_name: advisor.first_name,
            last_name: advisor.last_name,
            designation: 'Assistant Professor',
            designation_id: PLAIN_PROFESSOR_DESIGNATION_ID,
            department_id: advisor.department_id,
            staff_code: `FACX${advisor.id}`,
            status: 'active',
            is_mentor: false,
          },
        });
      }

      const movedSubjects = await prisma.faculty_subject_class_mapping.updateMany({
        where: { faculty_id: advisor.id },
        data: { faculty_id: newFaculty.id },
      });

      done++;
      console.log(`- ${advisor.users.email} (advisor) -> ${newEmail} (faculty): moved ${movedSubjects.count} subject mapping(s)`);
    } catch (err) {
      console.error(`  FAILED for ${advisor.users.email} (id ${advisor.id}):`, (err as Error).message);
    }
  }

  console.log(`\n=== Done: ${done} account(s) split ===`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error('FAILED:', e);
  await prisma.$disconnect();
  process.exit(1);
});
