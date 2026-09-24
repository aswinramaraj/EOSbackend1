import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Every faculty-only table in the Research & Development domain is mid-rename
 * to drop the `faculty_` prefix (see EOSbackend1/research_development_rename.query.md)
 * now that Publications/Research/Patents all accept student contributors too.
 * A straight ALTER TABLE RENAME breaks every typed `this.prisma.<old_name>.*`
 * call the moment `prisma generate` regenerates the client, in whichever
 * direction is stale. Every consumer resolves the live name once via one of
 * these helpers and interpolates it into raw SQL instead, so nothing breaks
 * whether the migration has been run yet or not. Cached module-wide since a
 * rename is a one-time admin action, not something that flips back and forth
 * while the process is running.
 */
function makeTableResolver<NewName extends string, OldName extends string>(
  newName: NewName,
  oldName: OldName,
) {
  let cached: NewName | OldName | null = null;
  return async (prisma: PrismaService): Promise<NewName | OldName> => {
    if (cached) return cached;
    try {
      await prisma.$queryRawUnsafe(`SELECT 1 FROM ${newName} LIMIT 1`);
      cached = newName;
    } catch {
      cached = oldName;
    }
    return cached;
  };
}

export const getPublicationsTable = makeTableResolver(
  'publications',
  'faculty_publications',
);
export const getResearchProjectsTable = makeTableResolver(
  'research_projects',
  'faculty_research_projects',
);
export const getResearchMembersTable = makeTableResolver(
  'research_project_members',
  'faculty_research_project_members',
);
export const getPatentsTable = makeTableResolver('patents', 'faculty_patents');
export const getPatentInventorsTable = makeTableResolver(
  'patent_inventors',
  'faculty_patent_inventors',
);

/** True once Research's rename + student_id column (research_development_rename.query.md Section 2) has been run — both land in the same migration, so the rename itself is the readiness signal. */
export async function researchAcceptsStudents(
  prisma: PrismaService,
): Promise<boolean> {
  return (await getResearchMembersTable(prisma)) === 'research_project_members';
}

/** True once Patents' rename + student_id column (research_development_rename.query.md Section 2) has been run — both land in the same migration, so the rename itself is the readiness signal. */
export async function patentsAcceptStudents(
  prisma: PrismaService,
): Promise<boolean> {
  return (await getPatentInventorsTable(prisma)) === 'patent_inventors';
}

let cachedContributorsExists: boolean | null = null;

/** Whether Step 2 of the same migration (the `publication_contributors` join table) has been run yet. */
export async function hasPublicationContributors(
  prisma: PrismaService,
): Promise<boolean> {
  if (cachedContributorsExists !== null) return cachedContributorsExists;
  try {
    await prisma.$queryRawUnsafe(
      'SELECT 1 FROM publication_contributors LIMIT 1',
    );
    cachedContributorsExists = true;
  } catch {
    cachedContributorsExists = false;
  }
  return cachedContributorsExists;
}
