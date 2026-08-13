import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

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
   * GET /me/mentee-entrepreneurship (Faculty — class advisor only). Scoped
   * live via class_mentors, resolved fresh every call — a reassignment to
   * a different class takes effect immediately, no stale caching.
   */
  async findAllForMentor(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({ where: { user_id: userId } });
    if (!faculty) return [];

    const mentorClasses = await this.prisma.class_mentors.findMany({
      where: { faculty_id: faculty.id },
      select: { class_id: true },
    });
    const classIds = mentorClasses.map((m) => m.class_id);
    if (classIds.length === 0) return [];

    try {
      const rows = await this.prisma.student_entrepreneurship.findMany({
        where: { students: { class_id: { in: classIds } } },
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
