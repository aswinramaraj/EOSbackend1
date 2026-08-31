import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { PrincipalFacultyService } from 'src/modules/principal/faculty/faculty.service';
import { AddPublicationEntryDto } from './dto/add-publication-entry.dto';
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
  constructor(
    private readonly prisma: PrismaService,
    private readonly faculty: PrincipalFacultyService,
  ) {}

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
   * method's aggregate return doesn't carry. indexing is read via a
   * guarded raw query (see add-publication-entry.dto.ts's ALTER
   * statements) — every paper has indexing=null until that column exists,
   * so the filter honestly has no effect (not a fabricated value) until
   * then.
   */
  async publicationVenues(indexing?: string) {
    const papers = await this.prisma.faculty_publications.findMany({
      select: {
        id: true,
        venue: true,
        citation_count: true,
        faculty: { select: { departments: { select: { code: true } } } },
      },
    });

    let indexingByPaperId = new Map<number, string | null>();
    try {
      const rows = await this.prisma.$queryRaw<
        { id: number; indexing: string | null }[]
      >`SELECT id, indexing FROM faculty_publications`;
      indexingByPaperId = new Map(rows.map((r) => [r.id, r.indexing]));
    } catch {
      // indexing column not added yet — every paper's indexing stays null.
    }

    const byVenue = new Map<
      string,
      { papers: number; citations: number; departments: Set<string> }
    >();
    for (const p of papers) {
      if (!p.venue) continue;
      if (indexing && indexingByPaperId.get(p.id) !== indexing) continue;
      const entry = byVenue.get(p.venue) ?? {
        papers: 0,
        citations: 0,
        departments: new Set<string>(),
      };
      entry.papers += 1;
      entry.citations += p.citation_count;
      if (p.faculty.departments?.code)
        entry.departments.add(p.faculty.departments.code);
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

  /** Every distinct real indexing value on file, for the Publications page's filter dropdown. Empty until the column exists. */
  async indexingOptions(): Promise<string[]> {
    try {
      const rows = await this.prisma.$queryRaw<
        { indexing: string }[]
      >`SELECT DISTINCT indexing FROM faculty_publications WHERE indexing IS NOT NULL ORDER BY indexing`;
      return rows.map((r) => r.indexing);
    } catch {
      return [];
    }
  }

  /**
   * GET /me/iqac/faculty-development/publications/quality
   *
   * faculty_publications.year is a plain calendar year (no month/day), so
   * "This year"/"Last year" compare that real year to the current calendar
   * year directly — not the Jul-Dec/Jan-Jun term window Attendance/Results
   * use for real DATE columns, since that finer split doesn't exist here.
   */
  async publicationsQuality() {
    const currentYear = new Date().getUTCFullYear();
    const [target, rows] = await Promise.all([
      this.targetFor('publications'),
      this.prisma.faculty_publications.findMany({ select: { year: true } }),
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

  /**
   * POST /me/iqac/faculty-development/publications/entries
   *
   * Creates the real faculty_publications row via PrincipalFacultyService's
   * own existing createPublication() (title/type/year/venue/citation_count),
   * then guards a raw-query UPDATE for author_role/indexing/published_date/
   * status — genuinely new columns, not yet in schema.prisma. Silently
   * no-ops per field until the ALTER statements in
   * add-publication-entry.dto.ts are run, same convention as
   * DrivesService.updateApplicationStatus()'s joining_date/work_location.
   */
  async addPublicationEntry(dto: AddPublicationEntryDto) {
    const publishedYear = dto.published_date
      ? new Date(dto.published_date).getUTCFullYear()
      : undefined;

    const created = await this.faculty.createPublication({
      faculty_id: dto.faculty_id,
      title: dto.title,
      type: 'journal',
      venue: dto.venue,
      year: publishedYear,
    });

    if (dto.author_role || dto.indexing || dto.published_date || dto.status) {
      try {
        await this.prisma.$executeRaw`
          UPDATE faculty_publications SET
            author_role = COALESCE(${dto.author_role ?? null}, author_role),
            indexing = COALESCE(${dto.indexing ?? null}, indexing),
            published_date = COALESCE(${dto.published_date ?? null}::date, published_date),
            status = COALESCE(${dto.status ?? null}, status)
          WHERE id = ${created.id}
        `;
      } catch {
        // additive columns not added yet — silently degrade.
      }
    }

    return created;
  }

  /**
   * PATCH /me/iqac/faculty-development/publications/:id — real
   * faculty_publications update. author_role/indexing/published_date/status
   * are real columns now (confirmed in schema.prisma), so this is a plain
   * typed update, not the guarded raw-query fallback addPublicationEntry()
   * still uses for its own historical reasons.
   */
  async updatePublicationEntry(id: number, dto: UpdatePublicationEntryDto) {
    const existing = await this.prisma.faculty_publications.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Publication not found',
        errorCode: 'PUBLICATION_NOT_FOUND',
      });
    }
    return this.prisma.faculty_publications.update({
      where: { id },
      data: {
        title: dto.title,
        venue: dto.venue,
        author_role: dto.author_role,
        indexing: dto.indexing,
        published_date: dto.published_date
          ? new Date(dto.published_date)
          : undefined,
        status: dto.status,
        citation_count: dto.citation_count,
      },
    });
  }

  /** DELETE /me/iqac/faculty-development/publications/:id */
  async removePublicationEntry(id: number) {
    const existing = await this.prisma.faculty_publications.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Publication not found',
        errorCode: 'PUBLICATION_NOT_FOUND',
      });
    }
    await this.prisma.faculty_publications.delete({ where: { id } });
    return { id, deleted: true };
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
    const [target, rows] = await Promise.all([
      this.targetFor('research'),
      this.prisma.faculty_research_project_members.findMany({
        where: { joined_on: { not: null } },
        select: { joined_on: true },
      }),
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

  /** GET /me/iqac/faculty-development/research?department_id= — real faculty_research_project_members rows, one per faculty-project membership. */
  async research(departmentId?: number) {
    const rows = await this.prisma.faculty_research_project_members.findMany({
      where:
        departmentId != null
          ? { faculty: { department_id: departmentId } }
          : undefined,
      orderBy: { id: 'desc' },
      include: {
        faculty: this.facultyInclude,
        faculty_research_projects: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      faculty: this.facultySummary(r.faculty),
      centre_name: r.faculty_research_projects.centre_name,
      focus_area: r.faculty_research_projects.focus_area,
      project_status: r.faculty_research_projects.status,
      role: r.role,
      joined_on: r.joined_on,
    }));
  }

  /**
   * POST /me/iqac/faculty-development/research — finds a real
   * faculty_research_projects row by exact centre_name or creates one
   * (focus_area only used on create), then inserts a real membership row.
   */
  async addResearchEntry(dto: AddResearchEntryDto) {
    let project = await this.prisma.faculty_research_projects.findFirst({
      where: { centre_name: dto.centre_name },
    });
    if (!project) {
      project = await this.prisma.faculty_research_projects.create({
        data: { centre_name: dto.centre_name, focus_area: dto.focus_area },
      });
    }
    return this.prisma.faculty_research_project_members.upsert({
      where: {
        project_id_faculty_id: {
          project_id: project.id,
          faculty_id: dto.faculty_id,
        },
      },
      create: {
        project_id: project.id,
        faculty_id: dto.faculty_id,
        role: dto.role,
        joined_on: dto.joined_on ? new Date(dto.joined_on) : undefined,
      },
      update: {
        role: dto.role,
        joined_on: dto.joined_on ? new Date(dto.joined_on) : undefined,
      },
    });
  }

  /**
   * PATCH /me/iqac/faculty-development/research/:id — id is the real
   * faculty_research_project_members row. role/joined_on edit that
   * membership; focus_area/status edit the shared faculty_research_projects
   * row (visible to every other member too — same convention as patents'
   * stage/filed_year below).
   */
  async updateResearchEntry(id: number, dto: UpdateResearchEntryDto) {
    const existing =
      await this.prisma.faculty_research_project_members.findUnique({
        where: { id },
      });
    if (!existing) {
      throw new NotFoundException({
        message: 'Research entry not found',
        errorCode: 'RESEARCH_ENTRY_NOT_FOUND',
      });
    }
    if (dto.focus_area !== undefined || dto.status !== undefined) {
      await this.prisma.faculty_research_projects.update({
        where: { id: existing.project_id },
        data: { focus_area: dto.focus_area, status: dto.status },
      });
    }
    return this.prisma.faculty_research_project_members.update({
      where: { id },
      data: {
        role: dto.role,
        joined_on: dto.joined_on ? new Date(dto.joined_on) : undefined,
      },
      include: { faculty_research_projects: true },
    });
  }

  /** DELETE /me/iqac/faculty-development/research/:id — removes just this faculty's membership, not the shared project. */
  async removeResearchEntry(id: number) {
    const existing =
      await this.prisma.faculty_research_project_members.findUnique({
        where: { id },
      });
    if (!existing) {
      throw new NotFoundException({
        message: 'Research entry not found',
        errorCode: 'RESEARCH_ENTRY_NOT_FOUND',
      });
    }
    await this.prisma.faculty_research_project_members.delete({
      where: { id },
    });
    return { id, deleted: true };
  }

  /** GET /me/iqac/faculty-development/patents/quality — bucketed by the real filed_year (calendar year, same convention as Publications). */
  async patentsQuality() {
    const currentYear = new Date().getUTCFullYear();
    const [target, rows] = await Promise.all([
      this.targetFor('patents'),
      this.prisma.faculty_patents.findMany({ select: { filed_year: true } }),
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

  /** GET /me/iqac/faculty-development/patents?department_id= — real faculty_patent_inventors rows, one per faculty-patent inventorship. */
  async patents(departmentId?: number) {
    const rows = await this.prisma.faculty_patent_inventors.findMany({
      where:
        departmentId != null
          ? { faculty: { department_id: departmentId } }
          : undefined,
      orderBy: { id: 'desc' },
      include: { faculty: this.facultyInclude, faculty_patents: true },
    });
    return rows.map((r) => ({
      id: r.id,
      faculty: this.facultySummary(r.faculty),
      title: r.faculty_patents.title,
      stage: r.faculty_patents.stage,
      filed_year: r.faculty_patents.filed_year,
      stage_date: r.faculty_patents.stage_date,
      role: r.role,
    }));
  }

  /**
   * POST /me/iqac/faculty-development/patents — finds a real faculty_patents
   * row by exact title or creates one (stage/filed_year/stage_date only
   * used on create), then inserts a real inventorship row.
   */
  async addPatentEntry(dto: AddPatentEntryDto) {
    let patent = await this.prisma.faculty_patents.findFirst({
      where: { title: dto.title },
    });
    if (!patent) {
      patent = await this.prisma.faculty_patents.create({
        data: {
          title: dto.title,
          stage: dto.stage,
          filed_year: dto.filed_year,
          stage_date: dto.stage_date ? new Date(dto.stage_date) : undefined,
        },
      });
    }
    return this.prisma.faculty_patent_inventors.upsert({
      where: {
        patent_id_faculty_id: {
          patent_id: patent.id,
          faculty_id: dto.faculty_id,
        },
      },
      create: {
        patent_id: patent.id,
        faculty_id: dto.faculty_id,
        role: dto.role,
      },
      update: { role: dto.role },
    });
  }

  /**
   * PATCH /me/iqac/faculty-development/patents/:id — id is the real
   * faculty_patent_inventors row. role edits that inventorship; title/
   * stage/filed_year/stage_date edit the shared faculty_patents row
   * (visible to every other inventor too) — this is how a patent's real
   * Filed → Granted progression gets recorded.
   */
  async updatePatentEntry(id: number, dto: UpdatePatentEntryDto) {
    const existing = await this.prisma.faculty_patent_inventors.findUnique({
      where: { id },
    });
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
      await this.prisma.faculty_patents.update({
        where: { id: existing.patent_id },
        data: {
          title: dto.title,
          stage: dto.stage,
          filed_year: dto.filed_year,
          stage_date: dto.stage_date ? new Date(dto.stage_date) : undefined,
        },
      });
    }
    return this.prisma.faculty_patent_inventors.update({
      where: { id },
      data: { role: dto.role },
      include: { faculty_patents: true },
    });
  }

  /** DELETE /me/iqac/faculty-development/patents/:id — removes just this faculty's inventorship, not the shared patent. */
  async removePatentEntry(id: number) {
    const existing = await this.prisma.faculty_patent_inventors.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Patent entry not found',
        errorCode: 'PATENT_ENTRY_NOT_FOUND',
      });
    }
    await this.prisma.faculty_patent_inventors.delete({ where: { id } });
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
