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
 * Principal-facing registry of students who've registered interest in
 * further studies (student_higher_education) - read-only, department-
 * scoped via a caller-chosen department (a Principal picks any department,
 * not just their own). At most one row per student (student_id is unique)
 * - never a log of multiple submissions.
 */
@Injectable()
export class StudentHigherEducationService {
  private readonly logger = new Logger(StudentHigherEducationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** GET /student-higher-education — every department at once, no picker. */
  async findAll() {
    try {
      const rows = await this.prisma.student_higher_education.findMany({
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
        preferred_course: row.preferred_course,
        preferred_country: row.preferred_country,
        preferred_university: row.preferred_university,
        remarks: row.remarks,
        created_at: row.created_at,
        student: toStudentSummaryWithDepartment(row.students),
      }));
    } catch (err) {
      this.logger.error('DB error listing all student_higher_education', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAllByDepartment(departmentId: number) {
    await this.assertDepartmentExists(departmentId);

    try {
      const rows = await this.prisma.student_higher_education.findMany({
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
        preferred_course: row.preferred_course,
        preferred_country: row.preferred_country,
        preferred_university: row.preferred_university,
        remarks: row.remarks,
        created_at: row.created_at,
        student: toStudentSummary(row.students),
      }));
    } catch (err) {
      this.logger.error(
        `DB error listing student_higher_education for department ${departmentId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /me/mentee-higher-education (Faculty — class advisor only). Scoped
   * live via class_mentors — every class the caller currently mentors,
   * resolved fresh on every call, so a reassignment takes effect
   * immediately with no stale caching of "which class" this faculty advises.
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
      const rows = await this.prisma.student_higher_education.findMany({
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
        },
        orderBy: { created_at: 'desc' },
      });

      return rows.map((row) => ({
        id: row.id,
        preferred_course: row.preferred_course,
        preferred_country: row.preferred_country,
        preferred_university: row.preferred_university,
        remarks: row.remarks,
        created_at: row.created_at,
        is_scholarship: row.is_scholarship,
        scholarship_name: row.scholarship_name,
        scholarship_value: row.scholarship_value !== null ? Number(row.scholarship_value) : null,
        admission_status: row.admission_status,
        offer_status: row.offer_status,
        visa_status: row.visa_status,
        intake_term: row.intake_term,
        sop_status: row.sop_status,
        recommendation_status: row.recommendation_status,
        research_output: row.research_output,
        internship_details: row.internship_details,
        application_submitted_date: row.application_submitted_date,
        interview_date: row.interview_date,
        funding_source: row.funding_source,
        student: toStudentSummary(row.students),
      }));
    } catch (err) {
      this.logger.error('DB error listing student_higher_education for mentor', err);
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
