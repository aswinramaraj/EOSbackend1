import { ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateStudentEntrepreneurshipDto } from './dto/create-student-entrepreneurship.dto';
import { UpdateStudentEntrepreneurshipDto } from './dto/update-student-entrepreneurship.dto';

const FUZZY_SIMILARITY_THRESHOLD = 0.2;

interface StudentFuzzySearchRow {
  id: number;
  student_id_no: string;
  roll_no: string | null;
  register_no: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  department_id: number | null;
  department_name: string | null;
  department_code: string | null;
  section: string | null;
  batch_name: string | null;
  has_venture: boolean;
  student_entrepreneurship_id: number | null;
  similarity: number;
}

interface StudentSummarySource {
  id: number;
  student_id_no: string;
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
  classes: { section: string } | null;
}

function resolveStudentDisplayName(student: StudentSummarySource): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

function toStudentSummary(student: StudentSummarySource) {
  return {
    id: student.id,
    student_id_no: student.student_id_no,
    name: resolveStudentDisplayName(student),
    section: student.classes?.section ?? null,
  };
}

interface StudentSummaryWithDeptSource extends StudentSummarySource {
  classes: { section: string; departments: { code: string; name: string } } | null;
}

function toStudentSummaryWithDepartment(student: StudentSummaryWithDeptSource) {
  return {
    ...toStudentSummary(student),
    department: student.classes?.departments ?? null,
  };
}

const VENTURE_DETAIL_INCLUDE = {
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { email: true } },
      classes: { select: { section: true, departments: { select: { code: true, name: true } } } },
    },
  },
  faculty: { select: { first_name: true, last_name: true } },
} as const;

interface VentureDetailSource {
  id: number;
  faculty: { first_name: string; last_name: string } | null;
  business_name: string;
  business_description: string | null;
  sector: string | null;
  stage: string | null;
  funding_required: unknown;
  remarks: string | null;
  created_at: Date;
  is_incubated: boolean | null;
  registration_type: string | null;
  website: string | null;
  venture_logo_url: string | null;
  current_status_note: string | null;
  role: string | null;
  year_started: number | null;
  business_category: string | null;
  problem_statement: string | null;
  location: string | null;
  business_model: string | null;
  target_customers: string | null;
  linkedin_url: string | null;
  co_founders: string | null;
  team_size: number | null;
  student_team_note: string | null;
  mentor_faculty_id: number | null;
  external_mentor_name: string | null;
  external_mentor_org: string | null;
  team_roles_note: string | null;
  idea_developed: boolean | null;
  prototype_developed: boolean | null;
  mvp_launched: boolean | null;
  product_launched: boolean | null;
  customers_count: number | null;
  monthly_revenue: unknown;
  growth_stage: string | null;
  funding_status: string | null;
  funding_received: unknown;
  funding_source: string | null;
  govt_grant_scheme: string | null;
  incubator_support: string | null;
  accelerator_support: string | null;
  students: StudentSummaryWithDeptSource;
}

/** Shared by every full-detail read (Coordinator's list/detail and the
 * student's own "My Venture" view) — one venture row, fully shaped, never
 * duplicated per caller. */
function toVentureDetail(row: VentureDetailSource) {
  return {
    id: row.id,
    mentor_faculty_name: row.faculty
      ? `${row.faculty.first_name} ${row.faculty.last_name}`
      : null,
    business_name: row.business_name,
    business_description: row.business_description,
    sector: row.sector,
    stage: row.stage,
    funding_required:
      row.funding_required !== null ? Number(row.funding_required) : null,
    remarks: row.remarks,
    created_at: row.created_at,
    is_incubated: row.is_incubated,
    registration_type: row.registration_type,
    website: row.website,
    venture_logo_url: row.venture_logo_url,
    current_status_note: row.current_status_note,
    role: row.role,
    year_started: row.year_started,
    business_category: row.business_category,
    problem_statement: row.problem_statement,
    location: row.location,
    business_model: row.business_model,
    target_customers: row.target_customers,
    linkedin_url: row.linkedin_url,
    co_founders: row.co_founders,
    team_size: row.team_size,
    student_team_note: row.student_team_note,
    mentor_faculty_id: row.mentor_faculty_id,
    external_mentor_name: row.external_mentor_name,
    external_mentor_org: row.external_mentor_org,
    team_roles_note: row.team_roles_note,
    idea_developed: row.idea_developed,
    prototype_developed: row.prototype_developed,
    mvp_launched: row.mvp_launched,
    product_launched: row.product_launched,
    customers_count: row.customers_count,
    monthly_revenue:
      row.monthly_revenue !== null ? Number(row.monthly_revenue) : null,
    growth_stage: row.growth_stage,
    funding_status: row.funding_status,
    funding_received:
      row.funding_received !== null ? Number(row.funding_received) : null,
    funding_source: row.funding_source,
    govt_grant_scheme: row.govt_grant_scheme,
    incubator_support: row.incubator_support,
    accelerator_support: row.accelerator_support,
    student: toStudentSummaryWithDepartment(row.students),
  };
}

/**
 * Principal-facing registry of students who've registered a startup/
 * business idea (student_entrepreneurship) - read-only, department-scoped
 * via a caller-chosen department. At most one row per student (student_id
 * is unique).
 */
@Injectable()
export class StudentEntrepreneurshipService {
  private readonly logger = new Logger(StudentEntrepreneurshipService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /student-entrepreneurship — every department at once, no picker. */
  async findAll() {
    try {
      const rows = await this.prisma.student_entrepreneurship.findMany({
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { section: true, departments: { select: { code: true, name: true } } } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      return rows.map((row) => ({
        id: row.id,
        business_name: row.business_name,
        business_description: row.business_description,
        sector: row.sector,
        stage: row.stage,
        funding_required: row.funding_required,
        remarks: row.remarks,
        created_at: row.created_at,
        student: toStudentSummaryWithDepartment(row.students),
      }));
    } catch (err) {
      this.logger.error('DB error listing all student_entrepreneurship', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAllByDepartment(departmentId: number) {
    await this.assertDepartmentExists(departmentId);

    try {
      const rows = await this.prisma.student_entrepreneurship.findMany({
        where: { students: { classes: { department_id: departmentId } } },
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { section: true } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      return rows.map((row) => ({
        id: row.id,
        business_name: row.business_name,
        business_description: row.business_description,
        sector: row.sector,
        stage: row.stage,
        funding_required: row.funding_required,
        remarks: row.remarks,
        created_at: row.created_at,
        student: toStudentSummary(row.students),
      }));
    } catch (err) {
      this.logger.error(
        `DB error listing student_entrepreneurship for department ${departmentId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /me/mentee-entrepreneurship (Faculty). Two independent ways a
   * venture can belong to this faculty member, unioned: (1) the student is
   * in a class this faculty is the class_mentor for, resolved fresh every
   * call so a reassignment takes effect immediately; (2) the EDC
   * Coordinator directly assigned this faculty as mentor_faculty_id on the
   * venture (via edc/mentors), independent of the student's class. Only
   * checking (1) meant a faculty mentoring ventures outside their own
   * class — the normal way EDC assigns mentors — saw nothing for them.
   */
  async findAllForMentor(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({ where: { user_id: userId } });
    if (!faculty) return [];

    const mentorClasses = await this.prisma.class_mentors.findMany({
      where: { faculty_id: faculty.id },
      select: { class_id: true },
    });
    const classIds = mentorClasses.map((m) => m.class_id);

    try {
      const rows = await this.prisma.student_entrepreneurship.findMany({
        where: {
          OR: [
            ...(classIds.length > 0
              ? [{ students: { class_id: { in: classIds } } }]
              : []),
            { mentor_faculty_id: faculty.id },
          ],
        },
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { section: true } },
            },
          },
          faculty: { select: { first_name: true, last_name: true } },
        },
        orderBy: { created_at: 'desc' },
      });

      return rows.map((row) => ({
        id: row.id,
        mentor_faculty_name: row.faculty ? `${row.faculty.first_name} ${row.faculty.last_name}` : null,
        business_name: row.business_name,
        business_description: row.business_description,
        sector: row.sector,
        stage: row.stage,
        funding_required: row.funding_required !== null ? Number(row.funding_required) : null,
        remarks: row.remarks,
        created_at: row.created_at,
        is_incubated: row.is_incubated,
        registration_type: row.registration_type,
        website: row.website,
        venture_logo_url: row.venture_logo_url,
        current_status_note: row.current_status_note,
        role: row.role,
        year_started: row.year_started,
        business_category: row.business_category,
        problem_statement: row.problem_statement,
        location: row.location,
        business_model: row.business_model,
        target_customers: row.target_customers,
        linkedin_url: row.linkedin_url,
        co_founders: row.co_founders,
        team_size: row.team_size,
        student_team_note: row.student_team_note,
        mentor_faculty_id: row.mentor_faculty_id,
        external_mentor_name: row.external_mentor_name,
        external_mentor_org: row.external_mentor_org,
        team_roles_note: row.team_roles_note,
        idea_developed: row.idea_developed,
        prototype_developed: row.prototype_developed,
        mvp_launched: row.mvp_launched,
        product_launched: row.product_launched,
        customers_count: row.customers_count,
        monthly_revenue: row.monthly_revenue !== null ? Number(row.monthly_revenue) : null,
        growth_stage: row.growth_stage,
        funding_status: row.funding_status,
        funding_received: row.funding_received !== null ? Number(row.funding_received) : null,
        funding_source: row.funding_source,
        govt_grant_scheme: row.govt_grant_scheme,
        incubator_support: row.incubator_support,
        accelerator_support: row.accelerator_support,
        student: toStudentSummary(row.students),
      }));
    } catch (err) {
      this.logger.error('DB error listing student_entrepreneurship for mentor', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /me/edc-entrepreneurship (EDC Coordinator only). Institution-wide,
   * every row — same rich field set as findAllForMentor() (that mapping was
   * already complete; the Coordinator just isn't scoped to any faculty's
   * mentee classes, unlike Faculty). Added for the EDC Portal module.
   */
  async findAllForCoordinator() {
    try {
      const rows = await this.prisma.student_entrepreneurship.findMany({
        include: VENTURE_DETAIL_INCLUDE,
        orderBy: { created_at: 'desc' },
      });

      return rows.map(toVentureDetail);
    } catch (err) {
      this.logger.error('DB error listing student_entrepreneurship for coordinator', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /me/entrepreneurship (Student only) — the caller's own venture, or
   * null if they've never registered one with the EDC. Same full shape as
   * the Coordinator's view (toVentureDetail), so the frontend reuses
   * EdcVentureDetail verbatim instead of a second bespoke read-only layout.
   */
  async findForStudent(userId: number) {
    try {
      const student = await this.prisma.students.findUnique({
        where: { user_id: userId },
        select: { id: true },
      });
      if (!student) {
        throw new NotFoundException({
          message: 'No student record found for this account',
          errorCode: 'STUDENT_RECORD_NOT_FOUND',
        });
      }

      const row = await this.prisma.student_entrepreneurship.findUnique({
        where: { student_id: student.id },
        include: VENTURE_DETAIL_INCLUDE,
      });

      return row ? toVentureDetail(row) : null;
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(
        'DB error reading student_entrepreneurship for student',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /me/edc-entrepreneurship/search-students?q= (EDC Coordinator only).
   * Typo-tolerant pg_trgm search over student_id_no/roll_no/register_no/
   * name/email — mirrors StudentLookupService.searchFuzzy's pattern
   * one-for-one (the only other real student-search endpoint in the repo),
   * with `has_venture` added so the "Add Student" screen can show/disable
   * a student who already has an entrepreneurship row (student_id is
   * @unique — at most one venture per student), and
   * `student_entrepreneurship_id` (the venture's own real id, null when
   * has_venture is false) so callers that need an existing venture — e.g.
   * Funding's "Log a disbursement" — can submit that id directly instead of
   * the student's own id (a real bug: edc_funding_records.student_entrepreneurship_id
   * references student_entrepreneurship.id, not students.id).
   */
  async searchStudentsForCoordinator(query: string, limit = 20) {
    const q = query.trim();
    const cappedLimit = Math.min(limit ?? 20, 20);

    const rows = await this.prisma.$queryRaw<StudentFuzzySearchRow[]>`
      SELECT
        s.id,
        s.student_id_no,
        s.roll_no,
        s.register_no,
        sa.first_name,
        sa.last_name,
        u.email,
        d.id AS department_id,
        d.name AS department_name,
        d.code AS department_code,
        cl.section,
        b.name AS batch_name,
        (se.id IS NOT NULL) AS has_venture,
        se.id AS student_entrepreneurship_id,
        GREATEST(
          similarity(s.student_id_no, ${q}),
          similarity(COALESCE(s.roll_no, ''), ${q}),
          similarity(COALESCE(s.register_no, ''), ${q}),
          word_similarity(${q}, COALESCE(sa.first_name, '') || ' ' || COALESCE(sa.last_name, '')),
          word_similarity(${q}, u.email)
        ) AS similarity
      FROM students s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN soa_applications sa ON sa.id = s.soa_application_id
      LEFT JOIN classes cl ON cl.id = s.class_id
      LEFT JOIN departments d ON d.id = cl.department_id
      LEFT JOIN batches b ON b.id = s.batch_id
      LEFT JOIN student_entrepreneurship se ON se.student_id = s.id
      WHERE
        similarity(s.student_id_no, ${q}) > ${FUZZY_SIMILARITY_THRESHOLD}
        OR similarity(COALESCE(s.roll_no, ''), ${q}) > ${FUZZY_SIMILARITY_THRESHOLD}
        OR similarity(COALESCE(s.register_no, ''), ${q}) > ${FUZZY_SIMILARITY_THRESHOLD}
        OR word_similarity(${q}, COALESCE(sa.first_name, '') || ' ' || COALESCE(sa.last_name, '')) > ${FUZZY_SIMILARITY_THRESHOLD}
        OR word_similarity(${q}, u.email) > ${FUZZY_SIMILARITY_THRESHOLD}
      ORDER BY similarity DESC
      LIMIT ${cappedLimit}
    `;

    return rows.map((row) => ({
      id: row.id,
      student_id_no: row.student_id_no,
      roll_no: row.roll_no,
      register_no: row.register_no,
      name: row.first_name ? (row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name) : `Student ${row.student_id_no}`,
      email: row.email,
      department: row.department_id ? { id: row.department_id, name: row.department_name, code: row.department_code } : null,
      section: row.section,
      batch_name: row.batch_name,
      has_venture: row.has_venture,
      student_entrepreneurship_id: row.student_entrepreneurship_id,
      similarity: Number(row.similarity),
    }));
  }

  /**
   * POST /me/edc-entrepreneurship (EDC Coordinator only). Creates the ONE
   * student_entrepreneurship row a student is allowed to have — pre-checks
   * both "student exists" and "no venture yet" with friendly errors rather
   * than letting the @unique constraint surface as a raw DB error.
   */
  async createForCoordinator(dto: CreateStudentEntrepreneurshipDto) {
    const student = await this.prisma.students.findUnique({ where: { id: dto.student_id } });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const existing = await this.prisma.student_entrepreneurship.findUnique({
      where: { student_id: dto.student_id },
    });
    if (existing) {
      throw new ConflictException({
        message: 'This student already has a venture on file',
        errorCode: 'VENTURE_ALREADY_EXISTS',
      });
    }

    try {
      const created = await this.prisma.student_entrepreneurship.create({
        data: {
          student_id: dto.student_id,
          business_name: dto.business_name,
          business_description: dto.business_description,
          sector: dto.sector,
          stage: dto.stage,
          funding_required: dto.funding_required,
          remarks: dto.remarks,
          registration_type: dto.registration_type,
          is_incubated: dto.is_incubated,
          role: dto.role,
          year_started: dto.year_started,
          current_status_note: dto.current_status_note,
          business_category: dto.business_category,
          problem_statement: dto.problem_statement,
          location: dto.location,
          business_model: dto.business_model,
          target_customers: dto.target_customers,
          website: dto.website,
          linkedin_url: dto.linkedin_url,
          co_founders: dto.co_founders,
          team_size: dto.team_size,
          student_team_note: dto.student_team_note,
          mentor_faculty_id: dto.mentor_faculty_id,
          external_mentor_name: dto.external_mentor_name,
          external_mentor_org: dto.external_mentor_org,
          team_roles_note: dto.team_roles_note,
          idea_developed: dto.idea_developed,
          prototype_developed: dto.prototype_developed,
          mvp_launched: dto.mvp_launched,
          product_launched: dto.product_launched,
          customers_count: dto.customers_count,
          monthly_revenue: dto.monthly_revenue,
          growth_stage: dto.growth_stage,
          funding_status: dto.funding_status,
          funding_received: dto.funding_received,
          funding_source: dto.funding_source,
          govt_grant_scheme: dto.govt_grant_scheme,
          incubator_support: dto.incubator_support,
          accelerator_support: dto.accelerator_support,
        },
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { section: true, departments: { select: { code: true, name: true } } } },
            },
          },
          faculty: { select: { first_name: true, last_name: true } },
        },
      });

      return {
        id: created.id,
        mentor_faculty_name: created.faculty ? `${created.faculty.first_name} ${created.faculty.last_name}` : null,
        business_name: created.business_name,
        business_description: created.business_description,
        sector: created.sector,
        stage: created.stage,
        funding_required: created.funding_required !== null ? Number(created.funding_required) : null,
        remarks: created.remarks,
        created_at: created.created_at,
        is_incubated: created.is_incubated,
        registration_type: created.registration_type,
        website: created.website,
        venture_logo_url: created.venture_logo_url,
        current_status_note: created.current_status_note,
        role: created.role,
        year_started: created.year_started,
        business_category: created.business_category,
        problem_statement: created.problem_statement,
        location: created.location,
        business_model: created.business_model,
        target_customers: created.target_customers,
        linkedin_url: created.linkedin_url,
        co_founders: created.co_founders,
        team_size: created.team_size,
        student_team_note: created.student_team_note,
        mentor_faculty_id: created.mentor_faculty_id,
        external_mentor_name: created.external_mentor_name,
        external_mentor_org: created.external_mentor_org,
        team_roles_note: created.team_roles_note,
        idea_developed: created.idea_developed,
        prototype_developed: created.prototype_developed,
        mvp_launched: created.mvp_launched,
        product_launched: created.product_launched,
        customers_count: created.customers_count,
        monthly_revenue: created.monthly_revenue !== null ? Number(created.monthly_revenue) : null,
        growth_stage: created.growth_stage,
        funding_status: created.funding_status,
        funding_received: created.funding_received !== null ? Number(created.funding_received) : null,
        funding_source: created.funding_source,
        govt_grant_scheme: created.govt_grant_scheme,
        incubator_support: created.incubator_support,
        accelerator_support: created.accelerator_support,
        student: toStudentSummaryWithDepartment(created.students),
      };
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({
          message: 'This student already has a venture on file',
          errorCode: 'VENTURE_ALREADY_EXISTS',
        });
      }
      this.logger.error('DB error creating student_entrepreneurship', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /me/edc-entrepreneurship/:id (EDC Coordinator only). No delete
   * endpoint existed at all before this. `incubations.student_entrepreneurship_id`
   * and `startup_ideas.converted_venture_id` are both `onDelete: NoAction`
   * (only `edc_documents` cascades automatically) — a plain delete would
   * throw a raw FK-violation error if the venture is incubated or is some
   * idea's converted-venture link, so this cleans those up first inside one
   * transaction rather than surfacing a confusing DB error to the user.
   */
  async removeForCoordinator(id: number) {
    const existing = await this.prisma.student_entrepreneurship.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Venture not found', errorCode: 'VENTURE_NOT_FOUND' });
    }
    try {
      await this.prisma.$transaction([
        this.prisma.incubation_milestones.deleteMany({
          where: { incubations: { student_entrepreneurship_id: id } },
        }),
        this.prisma.incubations.deleteMany({ where: { student_entrepreneurship_id: id } }),
        this.prisma.startup_ideas.updateMany({
          where: { converted_venture_id: id },
          data: { converted_venture_id: null },
        }),
        this.prisma.student_entrepreneurship.delete({ where: { id } }),
      ]);
      return { id, deleted: true };
    } catch (err) {
      this.logger.error('DB error deleting student_entrepreneurship', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * PATCH /me/edc-entrepreneurship/:id (EDC Coordinator only). The venture
   * has no update endpoint at all before this — added so the coordinator
   * can assign a mentor and fill in funding fields after the initial
   * "Add Student" create step, which is normally a bare-minimum submission.
   */
  async updateForCoordinator(id: number, dto: UpdateStudentEntrepreneurshipDto) {
    const existing = await this.prisma.student_entrepreneurship.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Venture not found', errorCode: 'VENTURE_NOT_FOUND' });
    }

    if (dto.mentor_faculty_id !== undefined) {
      const faculty = await this.prisma.faculty.findUnique({ where: { id: dto.mentor_faculty_id } });
      if (!faculty) {
        throw new NotFoundException({ message: 'Mentor faculty not found', errorCode: 'FACULTY_NOT_FOUND' });
      }
    }

    try {
      const updated = await this.prisma.student_entrepreneurship.update({
        where: { id },
        data: {
          business_name: dto.business_name,
          business_description: dto.business_description,
          sector: dto.sector,
          stage: dto.stage,
          funding_required: dto.funding_required,
          remarks: dto.remarks,
          registration_type: dto.registration_type,
          is_incubated: dto.is_incubated,
          role: dto.role,
          year_started: dto.year_started,
          current_status_note: dto.current_status_note,
          business_category: dto.business_category,
          problem_statement: dto.problem_statement,
          location: dto.location,
          business_model: dto.business_model,
          target_customers: dto.target_customers,
          website: dto.website,
          linkedin_url: dto.linkedin_url,
          co_founders: dto.co_founders,
          team_size: dto.team_size,
          student_team_note: dto.student_team_note,
          mentor_faculty_id: dto.mentor_faculty_id,
          external_mentor_name: dto.external_mentor_name,
          external_mentor_org: dto.external_mentor_org,
          team_roles_note: dto.team_roles_note,
          idea_developed: dto.idea_developed,
          prototype_developed: dto.prototype_developed,
          mvp_launched: dto.mvp_launched,
          product_launched: dto.product_launched,
          customers_count: dto.customers_count,
          monthly_revenue: dto.monthly_revenue,
          growth_stage: dto.growth_stage,
          funding_status: dto.funding_status,
          funding_received: dto.funding_received,
          funding_source: dto.funding_source,
          govt_grant_scheme: dto.govt_grant_scheme,
          incubator_support: dto.incubator_support,
          accelerator_support: dto.accelerator_support,
        },
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { section: true, departments: { select: { code: true, name: true } } } },
            },
          },
          faculty: { select: { first_name: true, last_name: true } },
        },
      });

      return {
        id: updated.id,
        mentor_faculty_name: updated.faculty ? `${updated.faculty.first_name} ${updated.faculty.last_name}` : null,
        business_name: updated.business_name,
        business_description: updated.business_description,
        sector: updated.sector,
        stage: updated.stage,
        funding_required: updated.funding_required !== null ? Number(updated.funding_required) : null,
        remarks: updated.remarks,
        created_at: updated.created_at,
        is_incubated: updated.is_incubated,
        registration_type: updated.registration_type,
        website: updated.website,
        venture_logo_url: updated.venture_logo_url,
        current_status_note: updated.current_status_note,
        role: updated.role,
        year_started: updated.year_started,
        business_category: updated.business_category,
        problem_statement: updated.problem_statement,
        location: updated.location,
        business_model: updated.business_model,
        target_customers: updated.target_customers,
        linkedin_url: updated.linkedin_url,
        co_founders: updated.co_founders,
        team_size: updated.team_size,
        student_team_note: updated.student_team_note,
        mentor_faculty_id: updated.mentor_faculty_id,
        external_mentor_name: updated.external_mentor_name,
        external_mentor_org: updated.external_mentor_org,
        team_roles_note: updated.team_roles_note,
        idea_developed: updated.idea_developed,
        prototype_developed: updated.prototype_developed,
        mvp_launched: updated.mvp_launched,
        product_launched: updated.product_launched,
        customers_count: updated.customers_count,
        monthly_revenue: updated.monthly_revenue !== null ? Number(updated.monthly_revenue) : null,
        growth_stage: updated.growth_stage,
        funding_status: updated.funding_status,
        funding_received: updated.funding_received !== null ? Number(updated.funding_received) : null,
        funding_source: updated.funding_source,
        govt_grant_scheme: updated.govt_grant_scheme,
        incubator_support: updated.incubator_support,
        accelerator_support: updated.accelerator_support,
        student: toStudentSummaryWithDepartment(updated.students),
      };
    } catch (err) {
      this.logger.error('DB error updating student_entrepreneurship', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertDepartmentExists(departmentId: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id: departmentId },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
  }
}
