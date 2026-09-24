import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { InstitutionDirectoryQueryDto } from 'src/common/dto/institution-directory-query.dto';

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
  class_id: number | null;
  classes: {
    section: string;
    departments: { code: string; name: string };
    batches: { name: string };
    courses: { code: string };
  } | null;
}

function toStudentSummaryWithDepartment(student: StudentSummaryWithDeptSource) {
  return {
    ...toStudentSummary(student),
    department: student.classes?.departments ?? null,
    class_id: student.class_id,
    batch_name: student.classes?.batches?.name ?? null,
    course_code: student.classes?.courses?.code ?? null,
  };
}

// Same reasoning as DrivesService's own filterByStudentSearch - a two-word
// query needs to match the CONCATENATED full name, not either half alone
// via a Prisma `OR`, and rows are already narrowed by batch/department/
// class first so filtering the remainder in memory is cheap.
function filterByStudentSearch<T extends { student: { name: string; student_id_no: string } }>(
  rows: T[],
  search?: string,
): T[] {
  const term = search?.trim().toLowerCase();
  if (!term) return rows;
  return rows.filter(
    (r) => r.student.name.toLowerCase().includes(term) || r.student.student_id_no.toLowerCase().includes(term),
  );
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

  /**
   * GET /student-higher-education — every department at once by default;
   * optionally narrowed by the Batch/Department/Class-with-Section filter
   * row + name-or-roll-no search box (see InstitutionDirectoryQueryDto).
   */
  async findAll(filters: InstitutionDirectoryQueryDto = {}) {
    try {
      const rows = await this.prisma.student_higher_education.findMany({
        where: {
          students: {
            ...(filters.class_id !== undefined && { class_id: filters.class_id }),
            ...((filters.batch_id !== undefined || filters.department_id !== undefined) && {
              classes: {
                ...(filters.department_id !== undefined && { department_id: filters.department_id }),
                ...(filters.batch_id !== undefined && { batch_id: filters.batch_id }),
              },
            }),
          },
        },
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              class_id: true,
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
              users: { select: { email: true } },
              classes: {
                select: {
                  section: true,
                  departments: { select: { code: true, name: true } },
                  batches: { select: { name: true } },
                  courses: { select: { code: true } },
                },
              },
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      const mapped = rows.map((row) => ({
        id: row.id,
        preferred_course: row.preferred_course,
        preferred_country: row.preferred_country,
        preferred_university: row.preferred_university,
        remarks: row.remarks,
        created_at: row.created_at,
        student: toStudentSummaryWithDepartment(row.students),
      }));
      return filterByStudentSearch(mapped, filters.search);
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
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
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
   * GET /me/higher-education (Student only) — the caller's own higher-studies
   * record, or null if they've never registered one (added by a Principal/
   * class advisor, same as student_entrepreneurship — a student has no
   * self-service create/update here, only a read of what staff have
   * recorded). Same full shape as findAllForMentor's row mapping, kept
   * consistent rather than a second bespoke shape for one more caller.
   */
  async findForStudent(userId: number) {
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

    try {
      const row = await this.prisma.student_higher_education.findUnique({
        where: { student_id: student.id },
      });
      if (!row) return null;

      return {
        id: row.id,
        preferred_course: row.preferred_course,
        preferred_country: row.preferred_country,
        preferred_university: row.preferred_university,
        remarks: row.remarks,
        created_at: row.created_at,
        is_scholarship: row.is_scholarship,
        scholarship_name: row.scholarship_name,
        scholarship_value:
          row.scholarship_value !== null ? Number(row.scholarship_value) : null,
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
      };
    } catch (err) {
      this.logger.error(
        'DB error reading student_higher_education for student',
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
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
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
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
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
        scholarship_value:
          row.scholarship_value !== null ? Number(row.scholarship_value) : null,
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
      this.logger.error(
        'DB error listing student_higher_education for mentor',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * Called by ClassMentorsService.findHigherEducationForClassMentor, AFTER
   * that method's own class_mentors mentor check. Unlike findAllForMentor
   * above (every class this faculty mentors, unioned), this is scoped to
   * ONE class — the mentee-class Academics page has no class picker (a
   * class advisor mentors exactly one class), so there's nothing to union.
   * Deliberately a smaller field set than HodHigherEducationService.
   * getOverview's rows (no batch/programme filters or scholarship/admission
   * status — the mobile Advisor screen just needs "who opted in and to
   * what", not the HoD dashboard's full triage view).
   */
  async findAllForClass(classId: number) {
    try {
      const rows = await this.prisma.student_higher_education.findMany({
        where: { students: { class_id: classId } },
        select: {
          id: true,
          preferred_course: true,
          preferred_country: true,
          preferred_university: true,
          remarks: true,
          created_at: true,
          students: {
            select: {
              id: true,
              student_id_no: true,
              photo_url: true,
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
              users: { select: { email: true } },
            },
          },
        },
        orderBy: { created_at: 'desc' },
      });

      return rows.map((row) => {
        const name = row.students.soa_applications
          ? `${row.students.soa_applications.first_name} ${row.students.soa_applications.last_name ?? ''}`.trim()
          : row.students.users.email;
        return {
          id: row.id,
          student: {
            id: row.students.id,
            name,
            student_id_no: row.students.student_id_no,
            photo_url: row.students.photo_url,
          },
          preferred_course: row.preferred_course,
          preferred_country: row.preferred_country,
          preferred_university: row.preferred_university,
          remarks: row.remarks,
          created_at: row.created_at,
        };
      });
    } catch (err) {
      this.logger.error(
        `DB error listing student_higher_education for class ${classId}`,
        err,
      );
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
