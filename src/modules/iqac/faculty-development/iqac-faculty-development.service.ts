import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  getPatentInventorsTable,
  getPatentsTable,
  getPublicationsTable,
  getResearchMembersTable,
  getResearchProjectsTable,
  hasPublicationContributors,
  patentsAcceptStudents,
  researchAcceptsStudents,
} from 'src/common/db/publications-table.util';
import { AddPublicationEntryDto } from './dto/add-publication-entry.dto';
import type { PublicationContributorDto } from './dto/publication-contributor.dto';
import { AddDevelopmentProgramEntryDto } from './dto/add-development-program-entry.dto';
import { AddResearchEntryDto } from './dto/add-research-entry.dto';
import { AddPatentEntryDto } from './dto/add-patent-entry.dto';
import { AddFacultyCertificationEntryDto } from './dto/add-faculty-certification-entry.dto';
import { UpdateDevelopmentProgramEntryDto } from './dto/update-development-program-entry.dto';
import { UpdateFacultyCertificationEntryDto } from './dto/update-faculty-certification-entry.dto';
import { UpdatePublicationEntryDto } from './dto/update-publication-entry.dto';
import { UpdateResearchEntryDto } from './dto/update-research-entry.dto';
import { UpdatePatentEntryDto } from './dto/update-patent-entry.dto';

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 'YYYY-YYYY', Jun cutoff — same convention as IqacAcademicQualityService/IqacStudentDevelopmentService. */
function currentAcademicYearLabel(today: Date): string {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  const start = month >= 6 ? calendarYear : calendarYear - 1;
  return `${start}-${start + 1}`;
}

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

/** Jul–Dec or Jan–Jun of the current calendar year — same "current term" window used across every other IQAC quality metric. */
function currentTermRange(today: Date): { start: Date; end: Date } {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  if (month >= 7) {
    return {
      start: new Date(Date.UTC(calendarYear, 6, 1)),
      end: new Date(Date.UTC(calendarYear, 11, 31)),
    };
  }
  return {
    start: new Date(Date.UTC(calendarYear, 0, 1)),
    end: new Date(Date.UTC(calendarYear, 5, 30)),
  };
}

function priorYearTermRange(range: { start: Date; end: Date }): {
  start: Date;
  end: Date;
} {
  return {
    start: new Date(
      Date.UTC(
        range.start.getUTCFullYear() - 1,
        range.start.getUTCMonth(),
        range.start.getUTCDate(),
      ),
    ),
    end: new Date(
      Date.UTC(
        range.end.getUTCFullYear() - 1,
        range.end.getUTCMonth(),
        range.end.getUTCDate(),
      ),
    ),
  };
}

function inRange(date: Date, range: { start: Date; end: Date }): boolean {
  return date >= range.start && date <= range.end;
}

@Injectable()
export class IqacFacultyDevelopmentService {
  constructor(private readonly prisma: PrismaService) {}

  private async targetFor(metricKey: string): Promise<number | null> {
    const row = await this.prisma.iqac_metric_targets.findUnique({
      where: {
        metric_key_academic_year: {
          metric_key: metricKey,
          academic_year: currentAcademicYearLabel(new Date()),
        },
      },
    });
    return row ? Number(row.target_value) : null;
  }

  /**
   * GET /me/iqac/faculty-development/publications/venues?indexing=
   *
   * Same shape as PrincipalFacultyService.leadingPublicationVenues(), but
   * computed fresh here (not a duplicate for its own sake) because
   * filtering by indexing needs per-paper indexing values, which that
   * method's aggregate return doesn't carry.
   */
  async publicationVenues(indexing?: string) {
    const table = await getPublicationsTable(this.prisma);
    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: number;
        venue: string | null;
        citation_count: number;
        indexing: string | null;
        dept_code: string | null;
      }[]
    >(`
      SELECT p.id, p.venue, p.citation_count, p.indexing, d.code AS dept_code
      FROM ${table} p
      LEFT JOIN faculty f ON f.id = p.faculty_id
      LEFT JOIN departments d ON d.id = f.department_id
    `);

    const byVenue = new Map<
      string,
      { papers: number; citations: number; departments: Set<string> }
    >();
    for (const p of rows) {
      if (!p.venue) continue;
      if (indexing && p.indexing !== indexing) continue;
      const entry = byVenue.get(p.venue) ?? {
        papers: 0,
        citations: 0,
        departments: new Set<string>(),
      };
      entry.papers += 1;
      entry.citations += p.citation_count;
      if (p.dept_code) entry.departments.add(p.dept_code);
      byVenue.set(p.venue, entry);
    }

    return [...byVenue.entries()]
      .map(([venue, e]) => ({
        venue,
        papers: e.papers,
        citations: e.citations,
        department_codes: [...e.departments],
      }))
      .sort((a, b) => b.papers - a.papers);
  }

  /** Every distinct real indexing value on file, for the Publications page's filter dropdown. */
  async indexingOptions(): Promise<string[]> {
    const table = await getPublicationsTable(this.prisma);
    const rows = await this.prisma.$queryRawUnsafe<{ indexing: string }[]>(
      `SELECT DISTINCT indexing FROM ${table} WHERE indexing IS NOT NULL ORDER BY indexing`,
    );
    return rows.map((r) => r.indexing);
  }

  /**
   * GET /me/iqac/faculty-development/publications/quality
   *
   * year is a plain calendar year (no month/day), so "This year"/"Last
   * year" compare that real year to the current calendar year directly —
   * not the Jul-Dec/Jan-Jun term window Attendance/Results use for real
   * DATE columns, since that finer split doesn't exist here.
   */
  async publicationsQuality() {
    const currentYear = new Date().getUTCFullYear();
    const table = await getPublicationsTable(this.prisma);
    const [target, rows] = await Promise.all([
      this.targetFor('publications'),
      this.prisma.$queryRawUnsafe<{ year: number | null }[]>(
        `SELECT year FROM ${table}`,
      ),
    ]);

    const thisYear = rows.filter((r) => r.year === currentYear).length;
    const lastYear = rows.filter((r) => r.year === currentYear - 1).length;

    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  private readonly missingContributorsError = new BadRequestException({
    message:
      'Recording contributors needs a pending database update — ask an admin to run research_development_rename.query.md first.',
    errorCode: 'PUBLICATION_CONTRIBUTORS_NOT_MIGRATED',
  });

  private async insertContributors(
    tx: Pick<PrismaService, '$executeRawUnsafe'>,
    publicationId: number,
    contributors: PublicationContributorDto[],
  ) {
    for (const c of contributors) {
      await tx.$executeRawUnsafe(
        `INSERT INTO publication_contributors (publication_id, faculty_id, student_id, role) VALUES ($1, $2, $3, $4)`,
        publicationId,
        c.type === 'faculty' ? c.id : null,
        c.type === 'student' ? c.id : null,
        c.role,
      );
    }
  }

  /** One publication's full row plus its resolved contributor list (name joined from faculty or students+soa_applications, same fallback-to-email convention as PrincipalStudentsService). */
  private async loadPublicationWithContributors(
    client: Pick<PrismaService, '$queryRawUnsafe'>,
    table: string,
    id: number,
  ) {
    const [pub] = await client.$queryRawUnsafe<
      {
        id: number;
        title: string;
        type: string;
        year: number | null;
        venue: string | null;
        doi: string | null;
        citation_count: number;
        indexing: string | null;
        published_date: Date | null;
        status: string | null;
      }[]
    >(
      `SELECT id, title, type, year, venue, doi, citation_count, indexing, published_date, status FROM ${table} WHERE id = $1`,
      id,
    );
    if (!pub) return null;

    const contributors = await client.$queryRawUnsafe<
      {
        type: 'faculty' | 'student';
        person_id: number;
        name: string;
        role: string;
      }[]
    >(
      `SELECT
         CASE WHEN pc.faculty_id IS NOT NULL THEN 'faculty' ELSE 'student' END AS type,
         COALESCE(pc.faculty_id, pc.student_id) AS person_id,
         CASE
           WHEN pc.faculty_id IS NOT NULL THEN f.first_name || ' ' || f.last_name
           ELSE COALESCE(NULLIF(TRIM(CONCAT_WS(' ', sa.first_name, sa.last_name)), ''), su.email)
         END AS name,
         pc.role
       FROM publication_contributors pc
       LEFT JOIN faculty f ON f.id = pc.faculty_id
       LEFT JOIN students s ON s.id = pc.student_id
       LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
       LEFT JOIN users su ON su.id = s.user_id
       WHERE pc.publication_id = $1
       ORDER BY pc.role, name`,
      id,
    );

    return {
      ...pub,
      contributors: contributors.map((c) => ({
        type: c.type,
        id: c.person_id,
        name: c.name,
        role: c.role,
      })),
    };
  }

  /**
   * POST /me/iqac/faculty-development/publications/entries
   *
   * Creates a real `publications` row plus one `publication_contributors`
   * row per submitted contributor (faculty and/or students, each tagged
   * Primary/Secondary author). Requires Steps 1-3 of
   * research_development_rename.query.md — surfaces a clear, actionable
   * error rather than silently truncating multiple/student contributors
   * down to one faculty author if that migration hasn't run yet.
   */
  async addPublicationEntry(dto: AddPublicationEntryDto) {
    const ready = await hasPublicationContributors(this.prisma);
    if (!ready) throw this.missingContributorsError;

    const table = await getPublicationsTable(this.prisma);
    const publishedYear = dto.published_date
      ? new Date(dto.published_date).getUTCFullYear()
      : null;

    return this.prisma.$transaction(async (tx) => {
      const [row] = await tx.$queryRawUnsafe<{ id: number }[]>(
        `INSERT INTO ${table} (title, type, year, venue, citation_count, created_at, indexing, published_date, status)
         VALUES ($1, 'journal', $2, $3, 0, now(), $4, $5::date, $6)
         RETURNING id`,
        dto.title,
        publishedYear,
        dto.venue ?? null,
        dto.indexing ?? null,
        dto.published_date ?? null,
        dto.status ?? null,
      );
      await this.insertContributors(tx, row.id, dto.contributors);
      return this.loadPublicationWithContributors(tx, table, row.id);
    });
  }

  /**
   * PATCH /me/iqac/faculty-development/publications/:id
   *
   * `contributors`, when provided, fully replaces the existing list
   * (delete + re-insert, inside the same transaction as the field update).
   */
  async updatePublicationEntry(id: number, dto: UpdatePublicationEntryDto) {
    const table = await getPublicationsTable(this.prisma);
    const [existing] = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM ${table} WHERE id = $1`,
      id,
    );
    if (!existing) {
      throw new NotFoundException({
        message: 'Publication not found',
        errorCode: 'PUBLICATION_NOT_FOUND',
      });
    }

    if (dto.contributors && !(await hasPublicationContributors(this.prisma))) {
      throw this.missingContributorsError;
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `UPDATE ${table} SET
           title = COALESCE($2, title),
           venue = COALESCE($3, venue),
           indexing = COALESCE($4, indexing),
           published_date = COALESCE($5::date, published_date),
           status = COALESCE($6, status),
           citation_count = COALESCE($7, citation_count)
         WHERE id = $1`,
        id,
        dto.title ?? null,
        dto.venue ?? null,
        dto.indexing ?? null,
        dto.published_date ?? null,
        dto.status ?? null,
        dto.citation_count ?? null,
      );

      if (dto.contributors) {
        await tx.$executeRawUnsafe(
          `DELETE FROM publication_contributors WHERE publication_id = $1`,
          id,
        );
        await this.insertContributors(tx, id, dto.contributors);
      }

      return this.loadPublicationWithContributors(tx, table, id);
    });
  }

  /** DELETE /me/iqac/faculty-development/publications/:id — publication_contributors rows cascade automatically once Steps 1-3 have run. */
  async removePublicationEntry(id: number) {
    const table = await getPublicationsTable(this.prisma);
    const [existing] = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM ${table} WHERE id = $1`,
      id,
    );
    if (!existing) {
      throw new NotFoundException({
        message: 'Publication not found',
        errorCode: 'PUBLICATION_NOT_FOUND',
      });
    }
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM ${table} WHERE id = $1`,
      id,
    );
    return { id, deleted: true };
  }

  /**
   * GET /me/iqac/faculty-development/publications/venues/:venue — every
   * real paper on file for one venue, with its full contributor list. The
   * IQAC-only successor to PrincipalFacultyService.venuePublications()
   * (which keeps its original single-author shape unchanged for its own
   * separate consumers). Pre-migration (no publication_contributors table
   * yet), each paper's still-present faculty_id/author_role is presented
   * as a one-item contributor list so the page renders sensibly either way.
   */
  async venuePublicationsWithContributors(venue: string) {
    const table = await getPublicationsTable(this.prisma);
    const ready = await hasPublicationContributors(this.prisma);
    const isUnspecified = venue === 'Unspecified venue';
    const whereVenue = isUnspecified
      ? `(venue IS NULL OR venue = '')`
      : `venue = $1`;
    const params = isUnspecified ? [] : [venue];

    const rows = await this.prisma.$queryRawUnsafe<
      {
        id: number;
        title: string;
        type: string;
        year: number | null;
        doi: string | null;
        citation_count: number;
      }[]
    >(
      `SELECT id, title, type, year, doi, citation_count FROM ${table} WHERE ${whereVenue} ORDER BY year DESC NULLS LAST`,
      ...params,
    );

    if (!ready) {
      const legacyRows = await this.prisma.$queryRawUnsafe<
        {
          id: number;
          faculty_id: number;
          author_role: string | null;
          first_name: string;
          last_name: string;
        }[]
      >(
        `SELECT p.id, p.faculty_id, p.author_role, f.first_name, f.last_name
         FROM ${table} p JOIN faculty f ON f.id = p.faculty_id
         WHERE ${whereVenue}`,
        ...params,
      );
      const byId = new Map(legacyRows.map((r) => [r.id, r]));
      return rows.map((r) => {
        const legacy = byId.get(r.id);
        return {
          ...r,
          contributors: legacy
            ? [
                {
                  type: 'faculty' as const,
                  id: legacy.faculty_id,
                  name: `${legacy.first_name} ${legacy.last_name}`,
                  role:
                    legacy.author_role === 'first_author' ||
                    legacy.author_role === 'corresponding_author'
                      ? 'primary_author'
                      : 'secondary_author',
                },
              ]
            : [],
        };
      });
    }

    const ids = rows.map((r) => r.id);
    const contributorRows = ids.length
      ? await this.prisma.$queryRawUnsafe<
          {
            publication_id: number;
            type: 'faculty' | 'student';
            person_id: number;
            name: string;
            role: string;
          }[]
        >(
          `SELECT pc.publication_id,
                  CASE WHEN pc.faculty_id IS NOT NULL THEN 'faculty' ELSE 'student' END AS type,
                  COALESCE(pc.faculty_id, pc.student_id) AS person_id,
                  CASE
                    WHEN pc.faculty_id IS NOT NULL THEN f.first_name || ' ' || f.last_name
                    ELSE COALESCE(NULLIF(TRIM(CONCAT_WS(' ', sa.first_name, sa.last_name)), ''), su.email)
                  END AS name,
                  pc.role
           FROM publication_contributors pc
           LEFT JOIN faculty f ON f.id = pc.faculty_id
           LEFT JOIN students s ON s.id = pc.student_id
           LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
           LEFT JOIN users su ON su.id = s.user_id
           WHERE pc.publication_id = ANY($1)
           ORDER BY pc.role, name`,
          ids,
        )
      : [];

    const byPublication = new Map<number, typeof contributorRows>();
    for (const c of contributorRows) {
      const list = byPublication.get(c.publication_id) ?? [];
      list.push(c);
      byPublication.set(c.publication_id, list);
    }

    return rows.map((r) => ({
      ...r,
      contributors: (byPublication.get(r.id) ?? []).map((c) => ({
        type: c.type,
        id: c.person_id,
        name: c.name,
        role: c.role,
      })),
    }));
  }

  /** Shared faculty summary shape for FDP/STTP/Research/Patents rows. */
  private facultySummary(faculty: {
    id: number;
    first_name: string;
    last_name: string;
    staff_code: string | null;
    designation: string;
    departments: { id: number; code: string; name: string } | null;
  }) {
    return {
      id: faculty.id,
      name: `${faculty.first_name} ${faculty.last_name}`,
      staff_code: faculty.staff_code,
      designation: faculty.designation,
      department: faculty.departments,
    };
  }

  private readonly facultyInclude = {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      staff_code: true,
      designation: true,
      departments: { select: { id: true, code: true, name: true } },
    },
  } as const;

  /** GET /me/iqac/faculty-development/{fdp,sttp}/quality — bucketed by the real attended_on date. */
  private async developmentProgramsQuality(programType: 'fdp' | 'sttp') {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);
    const [target, rows] = await Promise.all([
      this.targetFor(programType),
      this.prisma.faculty_development_programs.findMany({
        where: { program_type: programType, attended_on: { not: null } },
        select: { attended_on: true },
      }),
    ]);
    const thisYear = rows.filter((r) =>
      inRange(r.attended_on!, thisTerm),
    ).length;
    const lastYear = rows.filter((r) =>
      inRange(r.attended_on!, lastYearTerm),
    ).length;
    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  private async developmentPrograms(
    programType: 'fdp' | 'sttp',
    departmentId?: number,
  ) {
    const rows = await this.prisma.faculty_development_programs.findMany({
      where: {
        program_type: programType,
        ...(departmentId != null
          ? { faculty: { department_id: departmentId } }
          : {}),
      },
      orderBy: { id: 'desc' },
      include: { faculty: this.facultyInclude },
    });
    return rows.map((r) => ({
      id: r.id,
      faculty: this.facultySummary(r.faculty),
      programme_name: r.programme_name,
      host_agency: r.host_agency,
      duration: r.duration,
      attended_on: r.attended_on,
      status: r.status,
    }));
  }

  private addDevelopmentProgramEntry(
    programType: 'fdp' | 'sttp',
    dto: AddDevelopmentProgramEntryDto,
  ) {
    return this.prisma.faculty_development_programs.create({
      data: {
        faculty_id: dto.faculty_id,
        program_type: programType,
        programme_name: dto.programme_name,
        host_agency: dto.host_agency,
        duration: dto.duration,
        attended_on: dto.attended_on ? new Date(dto.attended_on) : undefined,
        status: dto.status,
      },
    });
  }

  /** PATCH /me/iqac/faculty-development/{fdp,sttp}/:id — program_type is fixed by the existing row, not re-checked against the route. */
  async updateDevelopmentProgramEntry(
    id: number,
    dto: UpdateDevelopmentProgramEntryDto,
  ) {
    const existing = await this.prisma.faculty_development_programs.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Entry not found',
        errorCode: 'DEVELOPMENT_PROGRAM_NOT_FOUND',
      });
    }
    return this.prisma.faculty_development_programs.update({
      where: { id },
      data: {
        programme_name: dto.programme_name,
        host_agency: dto.host_agency,
        duration: dto.duration,
        attended_on: dto.attended_on ? new Date(dto.attended_on) : undefined,
        status: dto.status,
      },
    });
  }

  /** DELETE /me/iqac/faculty-development/{fdp,sttp}/:id */
  async removeDevelopmentProgramEntry(id: number) {
    const existing = await this.prisma.faculty_development_programs.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Entry not found',
        errorCode: 'DEVELOPMENT_PROGRAM_NOT_FOUND',
      });
    }
    await this.prisma.faculty_development_programs.delete({ where: { id } });
    return { id, deleted: true };
  }

  fdpQuality() {
    return this.developmentProgramsQuality('fdp');
  }

  fdp(departmentId?: number) {
    return this.developmentPrograms('fdp', departmentId);
  }

  addFdpEntry(dto: AddDevelopmentProgramEntryDto) {
    return this.addDevelopmentProgramEntry('fdp', dto);
  }

  sttpQuality() {
    return this.developmentProgramsQuality('sttp');
  }

  sttp(departmentId?: number) {
    return this.developmentPrograms('sttp', departmentId);
  }

  addSttpEntry(dto: AddDevelopmentProgramEntryDto) {
    return this.addDevelopmentProgramEntry('sttp', dto);
  }

  /** GET /me/iqac/faculty-development/research/quality — bucketed by the real joined_on date. */
  async researchQuality() {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);
    const membersTable = await getResearchMembersTable(this.prisma);
    const [target, rows] = await Promise.all([
      this.targetFor('research'),
      this.prisma.$queryRawUnsafe<{ joined_on: Date | null }[]>(
        `SELECT joined_on FROM ${membersTable} WHERE joined_on IS NOT NULL`,
      ),
    ]);
    const thisYear = rows.filter((r) => inRange(r.joined_on!, thisTerm)).length;
    const lastYear = rows.filter((r) =>
      inRange(r.joined_on!, lastYearTerm),
    ).length;
    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  /**
   * GET /me/iqac/faculty-development/research?department_id= — real
   * research_project_members rows, one per contributor-project membership
   * (faculty and, once research_development_rename.query.md Section 2 has
   * run, students too).
   */
  async research(departmentId?: number) {
    const projectsTable = await getResearchProjectsTable(this.prisma);
    const membersTable = await getResearchMembersTable(this.prisma);

    type FacultyMemberRow = {
      id: number;
      role: string;
      joined_on: Date | null;
      centre_name: string;
      focus_area: string | null;
      project_status: string;
      faculty_id: number;
      first_name: string;
      last_name: string;
      designation: string;
      dept_code: string | null;
    };
    const facultySelect = `
      SELECT m.id, m.role, m.joined_on, p.centre_name, p.focus_area, p.status AS project_status,
             f.id AS faculty_id, f.first_name, f.last_name, f.designation, d.code AS dept_code
      FROM ${membersTable} m
      JOIN ${projectsTable} p ON p.id = m.project_id
      JOIN faculty f ON f.id = m.faculty_id
      LEFT JOIN departments d ON d.id = f.department_id`;
    const facultyRows =
      departmentId != null
        ? await this.prisma.$queryRawUnsafe<FacultyMemberRow[]>(
            `${facultySelect} WHERE f.department_id = $1 ORDER BY m.id DESC`,
            departmentId,
          )
        : await this.prisma.$queryRawUnsafe<FacultyMemberRow[]>(
            `${facultySelect} ORDER BY m.id DESC`,
          );

    const facultyResults = facultyRows.map((r) => ({
      id: r.id,
      contributor: {
        type: 'faculty' as const,
        id: r.faculty_id,
        name: `${r.first_name} ${r.last_name}`,
        subtitle: [r.designation, r.dept_code].filter(Boolean).join(' · '),
        department_code: r.dept_code,
      },
      centre_name: r.centre_name,
      focus_area: r.focus_area,
      project_status: r.project_status,
      role: r.role,
      joined_on: r.joined_on,
    }));

    if (!(await researchAcceptsStudents(this.prisma))) return facultyResults;

    type StudentMemberRow = {
      id: number;
      role: string;
      joined_on: Date | null;
      centre_name: string;
      focus_area: string | null;
      project_status: string;
      student_id: number;
      name: string;
      roll_no: string | null;
      dept_code: string | null;
    };
    const studentSelect = `
      SELECT m.id, m.role, m.joined_on, p.centre_name, p.focus_area, p.status AS project_status,
             s.id AS student_id,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', sa.first_name, sa.last_name)), ''), u.email) AS name,
             s.roll_no, d.code AS dept_code
      FROM ${membersTable} m
      JOIN ${projectsTable} p ON p.id = m.project_id
      JOIN students s ON s.id = m.student_id
      LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN courses c ON c.id = s.course_id
      LEFT JOIN departments d ON d.id = c.department_id`;
    const studentRows =
      departmentId != null
        ? await this.prisma.$queryRawUnsafe<StudentMemberRow[]>(
            `${studentSelect} WHERE c.department_id = $1 ORDER BY m.id DESC`,
            departmentId,
          )
        : await this.prisma.$queryRawUnsafe<StudentMemberRow[]>(
            `${studentSelect} ORDER BY m.id DESC`,
          );

    const studentResults = studentRows.map((r) => ({
      id: r.id,
      contributor: {
        type: 'student' as const,
        id: r.student_id,
        name: r.name,
        subtitle: [r.roll_no, r.dept_code].filter(Boolean).join(' · '),
        department_code: r.dept_code,
      },
      centre_name: r.centre_name,
      focus_area: r.focus_area,
      project_status: r.project_status,
      role: r.role,
      joined_on: r.joined_on,
    }));

    return [...facultyResults, ...studentResults].sort((a, b) => b.id - a.id);
  }

  /**
   * POST /me/iqac/faculty-development/research — finds a real
   * research_projects row by exact centre_name or creates one (focus_area
   * only used on create), then inserts one real membership row per
   * submitted contributor (faculty and/or students).
   */
  async addResearchEntry(dto: AddResearchEntryDto) {
    const projectsTable = await getResearchProjectsTable(this.prisma);
    const membersTable = await getResearchMembersTable(this.prisma);

    const [existingProject] = await this.prisma.$queryRawUnsafe<
      { id: number }[]
    >(
      `SELECT id FROM ${projectsTable} WHERE centre_name = $1`,
      dto.centre_name,
    );
    let projectId = existingProject?.id;
    if (projectId == null) {
      const [created] = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
        `INSERT INTO ${projectsTable} (centre_name, focus_area, status, created_at) VALUES ($1, $2, 'ongoing', now()) RETURNING id`,
        dto.centre_name,
        dto.focus_area ?? null,
      );
      projectId = created.id;
    }

    const facultyContributors = dto.contributors.filter(
      (c) => c.type === 'faculty',
    );
    const studentContributors = dto.contributors.filter(
      (c) => c.type === 'student',
    );

    if (
      studentContributors.length > 0 &&
      !(await researchAcceptsStudents(this.prisma))
    ) {
      throw new BadRequestException({
        message:
          'Adding student contributors needs a pending database update — ask an admin to run research_development_rename.query.md (Section 2) first.',
        errorCode: 'RESEARCH_STUDENTS_NOT_MIGRATED',
      });
    }

    for (const c of facultyContributors) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO ${membersTable} (project_id, faculty_id, role, joined_on)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, faculty_id) DO UPDATE SET role = EXCLUDED.role, joined_on = EXCLUDED.joined_on`,
        projectId,
        c.id,
        c.role,
        dto.joined_on ?? null,
      );
    }
    for (const c of studentContributors) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO ${membersTable} (project_id, student_id, role, joined_on)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (project_id, student_id) WHERE student_id IS NOT NULL
         DO UPDATE SET role = EXCLUDED.role, joined_on = EXCLUDED.joined_on`,
        projectId,
        c.id,
        c.role,
        dto.joined_on ?? null,
      );
    }

    return { project_id: projectId, added: dto.contributors.length };
  }

  /**
   * PATCH /me/iqac/faculty-development/research/:id — id is the real
   * research_project_members row. role/joined_on edit that membership;
   * focus_area/status edit the shared research_projects row (visible to
   * every other member too — same convention as patents' stage/filed_year
   * below).
   */
  async updateResearchEntry(id: number, dto: UpdateResearchEntryDto) {
    const projectsTable = await getResearchProjectsTable(this.prisma);
    const membersTable = await getResearchMembersTable(this.prisma);

    const [existing] = await this.prisma.$queryRawUnsafe<
      { id: number; project_id: number }[]
    >(`SELECT id, project_id FROM ${membersTable} WHERE id = $1`, id);
    if (!existing) {
      throw new NotFoundException({
        message: 'Research entry not found',
        errorCode: 'RESEARCH_ENTRY_NOT_FOUND',
      });
    }
    if (dto.focus_area !== undefined || dto.status !== undefined) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE ${projectsTable} SET focus_area = COALESCE($2, focus_area), status = COALESCE($3, status) WHERE id = $1`,
        existing.project_id,
        dto.focus_area ?? null,
        dto.status ?? null,
      );
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE ${membersTable} SET role = COALESCE($2, role), joined_on = COALESCE($3::date, joined_on) WHERE id = $1`,
      id,
      dto.role ?? null,
      dto.joined_on ?? null,
    );
    const [updated] = await this.prisma.$queryRawUnsafe<
      Record<string, unknown>[]
    >(
      `SELECT m.*, p.centre_name, p.focus_area, p.status AS project_status
       FROM ${membersTable} m JOIN ${projectsTable} p ON p.id = m.project_id WHERE m.id = $1`,
      id,
    );
    return updated;
  }

  /** DELETE /me/iqac/faculty-development/research/:id — removes just this contributor's membership, not the shared project. */
  async removeResearchEntry(id: number) {
    const membersTable = await getResearchMembersTable(this.prisma);
    const [existing] = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM ${membersTable} WHERE id = $1`,
      id,
    );
    if (!existing) {
      throw new NotFoundException({
        message: 'Research entry not found',
        errorCode: 'RESEARCH_ENTRY_NOT_FOUND',
      });
    }
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM ${membersTable} WHERE id = $1`,
      id,
    );
    return { id, deleted: true };
  }

  /** GET /me/iqac/faculty-development/patents/quality — bucketed by the real filed_year (calendar year, same convention as Publications). */
  async patentsQuality() {
    const currentYear = new Date().getUTCFullYear();
    const patentsTable = await getPatentsTable(this.prisma);
    const [target, rows] = await Promise.all([
      this.targetFor('patents'),
      this.prisma.$queryRawUnsafe<{ filed_year: number | null }[]>(
        `SELECT filed_year FROM ${patentsTable}`,
      ),
    ]);
    const thisYear = rows.filter((r) => r.filed_year === currentYear).length;
    const lastYear = rows.filter(
      (r) => r.filed_year === currentYear - 1,
    ).length;
    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  /**
   * GET /me/iqac/faculty-development/patents?department_id= — real
   * patent_inventors rows, one per contributor-patent inventorship (faculty
   * and, once research_development_rename.query.md Section 2 has run,
   * students too).
   */
  async patents(departmentId?: number) {
    const patentsTable = await getPatentsTable(this.prisma);
    const inventorsTable = await getPatentInventorsTable(this.prisma);

    type FacultyInventorRow = {
      id: number;
      role: string;
      title: string;
      stage: string;
      filed_year: number | null;
      stage_date: Date | null;
      faculty_id: number;
      first_name: string;
      last_name: string;
      designation: string;
      dept_code: string | null;
    };
    const facultySelect = `
      SELECT i.id, i.role, p.title, p.stage, p.filed_year, p.stage_date,
             f.id AS faculty_id, f.first_name, f.last_name, f.designation, d.code AS dept_code
      FROM ${inventorsTable} i
      JOIN ${patentsTable} p ON p.id = i.patent_id
      JOIN faculty f ON f.id = i.faculty_id
      LEFT JOIN departments d ON d.id = f.department_id`;
    const facultyRows =
      departmentId != null
        ? await this.prisma.$queryRawUnsafe<FacultyInventorRow[]>(
            `${facultySelect} WHERE f.department_id = $1 ORDER BY i.id DESC`,
            departmentId,
          )
        : await this.prisma.$queryRawUnsafe<FacultyInventorRow[]>(
            `${facultySelect} ORDER BY i.id DESC`,
          );

    const facultyResults = facultyRows.map((r) => ({
      id: r.id,
      contributor: {
        type: 'faculty' as const,
        id: r.faculty_id,
        name: `${r.first_name} ${r.last_name}`,
        subtitle: [r.designation, r.dept_code].filter(Boolean).join(' · '),
        department_code: r.dept_code,
      },
      title: r.title,
      stage: r.stage,
      filed_year: r.filed_year,
      stage_date: r.stage_date,
      role: r.role,
    }));

    if (!(await patentsAcceptStudents(this.prisma))) return facultyResults;

    type StudentInventorRow = {
      id: number;
      role: string;
      title: string;
      stage: string;
      filed_year: number | null;
      stage_date: Date | null;
      student_id: number;
      name: string;
      roll_no: string | null;
      dept_code: string | null;
    };
    const studentSelect = `
      SELECT i.id, i.role, p.title, p.stage, p.filed_year, p.stage_date,
             s.id AS student_id,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', sa.first_name, sa.last_name)), ''), u.email) AS name,
             s.roll_no, d.code AS dept_code
      FROM ${inventorsTable} i
      JOIN ${patentsTable} p ON p.id = i.patent_id
      JOIN students s ON s.id = i.student_id
      LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN courses c ON c.id = s.course_id
      LEFT JOIN departments d ON d.id = c.department_id`;
    const studentRows =
      departmentId != null
        ? await this.prisma.$queryRawUnsafe<StudentInventorRow[]>(
            `${studentSelect} WHERE c.department_id = $1 ORDER BY i.id DESC`,
            departmentId,
          )
        : await this.prisma.$queryRawUnsafe<StudentInventorRow[]>(
            `${studentSelect} ORDER BY i.id DESC`,
          );

    const studentResults = studentRows.map((r) => ({
      id: r.id,
      contributor: {
        type: 'student' as const,
        id: r.student_id,
        name: r.name,
        subtitle: [r.roll_no, r.dept_code].filter(Boolean).join(' · '),
        department_code: r.dept_code,
      },
      title: r.title,
      stage: r.stage,
      filed_year: r.filed_year,
      stage_date: r.stage_date,
      role: r.role,
    }));

    return [...facultyResults, ...studentResults].sort((a, b) => b.id - a.id);
  }

  /**
   * POST /me/iqac/faculty-development/patents — finds a real patents row by
   * exact title or creates one (stage/filed_year/stage_date only used on
   * create), then inserts one real inventorship row per submitted
   * contributor (faculty and/or students).
   */
  async addPatentEntry(dto: AddPatentEntryDto) {
    const patentsTable = await getPatentsTable(this.prisma);
    const inventorsTable = await getPatentInventorsTable(this.prisma);

    const [existingPatent] = await this.prisma.$queryRawUnsafe<
      { id: number }[]
    >(`SELECT id FROM ${patentsTable} WHERE title = $1`, dto.title);
    let patentId = existingPatent?.id;
    if (patentId == null) {
      const [created] = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
        `INSERT INTO ${patentsTable} (title, stage, filed_year, stage_date, created_at)
         VALUES ($1, $2, $3, $4::date, now()) RETURNING id`,
        dto.title,
        dto.stage ?? 'filed',
        dto.filed_year ?? null,
        dto.stage_date ?? null,
      );
      patentId = created.id;
    }

    const facultyContributors = dto.contributors.filter(
      (c) => c.type === 'faculty',
    );
    const studentContributors = dto.contributors.filter(
      (c) => c.type === 'student',
    );

    if (
      studentContributors.length > 0 &&
      !(await patentsAcceptStudents(this.prisma))
    ) {
      throw new BadRequestException({
        message:
          'Adding student contributors needs a pending database update — ask an admin to run research_development_rename.query.md (Section 2) first.',
        errorCode: 'PATENT_STUDENTS_NOT_MIGRATED',
      });
    }

    for (const c of facultyContributors) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO ${inventorsTable} (patent_id, faculty_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (patent_id, faculty_id) DO UPDATE SET role = EXCLUDED.role`,
        patentId,
        c.id,
        c.role,
      );
    }
    for (const c of studentContributors) {
      await this.prisma.$executeRawUnsafe(
        `INSERT INTO ${inventorsTable} (patent_id, student_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (patent_id, student_id) WHERE student_id IS NOT NULL
         DO UPDATE SET role = EXCLUDED.role`,
        patentId,
        c.id,
        c.role,
      );
    }

    return { patent_id: patentId, added: dto.contributors.length };
  }

  /**
   * PATCH /me/iqac/faculty-development/patents/:id — id is the real
   * patent_inventors row. role edits that inventorship; title/stage/
   * filed_year/stage_date edit the shared patents row (visible to every
   * other inventor too) — this is how a patent's real Filed → Granted
   * progression gets recorded.
   */
  async updatePatentEntry(id: number, dto: UpdatePatentEntryDto) {
    const patentsTable = await getPatentsTable(this.prisma);
    const inventorsTable = await getPatentInventorsTable(this.prisma);

    const [existing] = await this.prisma.$queryRawUnsafe<
      { id: number; patent_id: number }[]
    >(`SELECT id, patent_id FROM ${inventorsTable} WHERE id = $1`, id);
    if (!existing) {
      throw new NotFoundException({
        message: 'Patent entry not found',
        errorCode: 'PATENT_ENTRY_NOT_FOUND',
      });
    }
    if (
      dto.title !== undefined ||
      dto.stage !== undefined ||
      dto.filed_year !== undefined ||
      dto.stage_date !== undefined
    ) {
      await this.prisma.$executeRawUnsafe(
        `UPDATE ${patentsTable} SET
           title = COALESCE($2, title),
           stage = COALESCE($3, stage),
           filed_year = COALESCE($4, filed_year),
           stage_date = COALESCE($5::date, stage_date)
         WHERE id = $1`,
        existing.patent_id,
        dto.title ?? null,
        dto.stage ?? null,
        dto.filed_year ?? null,
        dto.stage_date ?? null,
      );
    }
    await this.prisma.$executeRawUnsafe(
      `UPDATE ${inventorsTable} SET role = COALESCE($2, role) WHERE id = $1`,
      id,
      dto.role ?? null,
    );
    const [updated] = await this.prisma.$queryRawUnsafe<
      Record<string, unknown>[]
    >(
      `SELECT i.*, p.title, p.stage, p.filed_year, p.stage_date
       FROM ${inventorsTable} i JOIN ${patentsTable} p ON p.id = i.patent_id WHERE i.id = $1`,
      id,
    );
    return updated;
  }

  /** DELETE /me/iqac/faculty-development/patents/:id — removes just this contributor's inventorship, not the shared patent. */
  async removePatentEntry(id: number) {
    const inventorsTable = await getPatentInventorsTable(this.prisma);
    const [existing] = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
      `SELECT id FROM ${inventorsTable} WHERE id = $1`,
      id,
    );
    if (!existing) {
      throw new NotFoundException({
        message: 'Patent entry not found',
        errorCode: 'PATENT_ENTRY_NOT_FOUND',
      });
    }
    await this.prisma.$executeRawUnsafe(
      `DELETE FROM ${inventorsTable} WHERE id = $1`,
      id,
    );
    return { id, deleted: true };
  }

  /** GET /me/iqac/faculty-development/certifications/quality — bucketed by the real completed_on date. */
  async facultyCertificationsQuality() {
    const thisTerm = currentTermRange(startOfToday());
    const lastYearTerm = priorYearTermRange(thisTerm);
    const [target, rows] = await Promise.all([
      this.targetFor('faculty_certifications'),
      this.prisma.faculty_certifications.findMany({
        where: { completed_on: { not: null } },
        select: { completed_on: true },
      }),
    ]);
    const thisYear = rows.filter((r) =>
      inRange(r.completed_on!, thisTerm),
    ).length;
    const lastYear = rows.filter((r) =>
      inRange(r.completed_on!, lastYearTerm),
    ).length;
    return {
      this_year: thisYear,
      last_year: lastYear,
      target,
      attainment: target != null ? round1((thisYear / target) * 100) : null,
    };
  }

  /** GET /me/iqac/faculty-development/certifications?department_id= — real faculty_certifications rows. */
  async facultyCertifications(departmentId?: number) {
    const rows = await this.prisma.faculty_certifications.findMany({
      where:
        departmentId != null
          ? { faculty: { department_id: departmentId } }
          : undefined,
      orderBy: { id: 'desc' },
      include: { faculty: this.facultyInclude },
    });
    return rows.map((r) => ({
      id: r.id,
      faculty: this.facultySummary(r.faculty),
      platform: r.platform,
      track: r.track,
      score: r.score,
      completed_on: r.completed_on,
      status: r.status,
      certificate_url: r.certificate_url,
    }));
  }

  /** POST /me/iqac/faculty-development/certifications — real faculty_certifications insert. */
  addFacultyCertificationEntry(dto: AddFacultyCertificationEntryDto) {
    return this.prisma.faculty_certifications.create({
      data: {
        faculty_id: dto.faculty_id,
        platform: dto.platform,
        track: dto.track,
        score: dto.score,
        completed_on: dto.completed_on ? new Date(dto.completed_on) : undefined,
        status: dto.status,
        certificate_url: dto.certificate_url,
      },
    });
  }

  /** PATCH /me/iqac/faculty-development/certifications/:id — real faculty_certifications update. */
  async updateFacultyCertificationEntry(
    id: number,
    dto: UpdateFacultyCertificationEntryDto,
  ) {
    const existing = await this.prisma.faculty_certifications.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Certification entry not found',
        errorCode: 'CERTIFICATION_NOT_FOUND',
      });
    }
    return this.prisma.faculty_certifications.update({
      where: { id },
      data: {
        platform: dto.platform,
        track: dto.track,
        score: dto.score,
        completed_on: dto.completed_on ? new Date(dto.completed_on) : undefined,
        status: dto.status,
        certificate_url: dto.certificate_url,
      },
    });
  }

  /** DELETE /me/iqac/faculty-development/certifications/:id */
  async removeFacultyCertificationEntry(id: number) {
    const existing = await this.prisma.faculty_certifications.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Certification entry not found',
        errorCode: 'CERTIFICATION_NOT_FOUND',
      });
    }
    await this.prisma.faculty_certifications.delete({ where: { id } });
    return { id, deleted: true };
  }
}
