import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

/** Same GRADE_LOOKUP formula as HodService/PrincipalExamsService, reused verbatim. */
const GRADE_LOOKUP = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT is_pass, grade_point FROM grade_bands gb2
    WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
    ORDER BY gb2.min_percentage DESC LIMIT 1
  ) gb ON true
`;

function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

const OVERSEAS_KEYWORD_EXCLUDE = ['india'];

/**
 * GET /hod/higher-education(|:id) — department-scoped higher-education
 * aspirants, from the real `student_higher_education` table (a genuine
 * 1:1 profile row per interested student — not every student has one).
 * "Overseas" = preferred_country isn't India (case-insensitive) — no
 * dedicated boolean column exists for this. Every query sequential
 * (Supabase's session-mode pool caps at 15 connections).
 */
@Injectable()
export class HodHigherEducationService {
  private readonly logger = new Logger(HodHigherEducationService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveDepartmentId(user: JwtPayload): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.department_id;
  }

  async getOverview(
    user: JwtPayload,
    search?: string,
    batchId?: number,
    programme?: string,
  ) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
        select: { id: true, name: true, code: true },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found.',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }

      const applicants = await this.prisma.student_higher_education.findMany({
        where: {
          students: {
            status: 'active',
            classes: {
              department_id: departmentId,
              ...(batchId ? { batch_id: batchId } : {}),
            },
            ...(search
              ? {
                  OR: [
                    {
                      student_id_no: {
                        contains: search,
                        mode: 'insensitive' as const,
                      },
                    },
                    {
                      soa_applications: {
                        first_name: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                    {
                      soa_applications: {
                        last_name: {
                          contains: search,
                          mode: 'insensitive' as const,
                        },
                      },
                    },
                  ],
                }
              : {}),
          },
          ...(programme ? { preferred_course: programme } : {}),
        },
        select: {
          id: true,
          preferred_course: true,
          preferred_country: true,
          preferred_university: true,
          remarks: true,
          scholarship_name: true,
          admission_status: true,
          students: {
            select: {
              id: true,
              student_id_no: true,
              photo_url: true,
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
              classes: {
                select: { batches: { select: { id: true, name: true } } },
              },
            },
          },
        },
        orderBy: { id: 'desc' },
      });

      const allBatches = await this.prisma.batches.findMany({
        where: { classes: { some: { department_id: departmentId } } },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      });
      const allProgrammes = [
        ...new Set(applicants.map((a) => a.preferred_course).filter(Boolean)),
      ];

      const countries = [
        ...new Set(applicants.map((a) => a.preferred_country).filter(Boolean)),
      ];
      const overseasCount = applicants.filter(
        (a) =>
          !OVERSEAS_KEYWORD_EXCLUDE.includes(a.preferred_country.toLowerCase()),
      ).length;

      return {
        department: {
          id: department.id,
          name: department.name,
          code: department.code,
        },
        stats: {
          total: applicants.length,
          overseas_count: overseasCount,
          domestic_count: applicants.length - overseasCount,
          countries,
        },
        filters: {
          batches: allBatches.map((b) => ({ batch_id: b.id, label: b.name })),
          programmes: allProgrammes,
        },
        rows: applicants.map((a) => ({
          id: a.id,
          student_id: a.students.id,
          student_id_no: a.students.student_id_no,
          name: a.students.soa_applications
            ? `${a.students.soa_applications.first_name} ${a.students.soa_applications.last_name ?? ''}`.trim()
            : '—',
          photo_url: a.students.photo_url,
          department_code: department.code,
          batch_label: a.students.classes?.batches.name ?? null,
          programme: a.preferred_course,
          university: a.preferred_university,
          country: a.preferred_country,
          remarks: a.remarks,
          scholarship: a.scholarship_name,
          status: a.admission_status,
        })),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error(
        'DB error computing HoD higher-education overview',
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getProfile(user: JwtPayload, id: number) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const record = await this.prisma.student_higher_education.findUnique({
        where: { id },
        select: {
          id: true,
          preferred_course: true,
          preferred_country: true,
          preferred_university: true,
          is_scholarship: true,
          scholarship_name: true,
          scholarship_value: true,
          intake_term: true,
          sop_status: true,
          recommendation_status: true,
          research_output: true,
          internship_details: true,
          visa_status: true,
          application_submitted_date: true,
          interview_date: true,
          offer_status: true,
          funding_source: true,
          admission_status: true,
          cgpa: true,
          percentage: true,
          test_scores_summary: true,
          remarks: true,
          students: {
            select: {
              id: true,
              student_id_no: true,
              photo_url: true,
              users: { select: { email: true, phone: true } },
              soa_applications: {
                select: {
                  first_name: true,
                  last_name: true,
                  student_contact: true,
                },
              },
              classes: {
                select: {
                  section: true,
                  current_semester: true,
                  departments: { select: { code: true } },
                  batches: { select: { name: true } },
                },
              },
            },
          },
        },
      });
      if (!record || record.students.classes?.departments.code == null) {
        throw new NotFoundException({
          message: 'Higher-education profile not found.',
          errorCode: 'PROFILE_NOT_FOUND',
        });
      }
      const studentDept = await this.prisma.students.findUnique({
        where: { id: record.students.id },
        select: { classes: { select: { department_id: true } } },
      });
      if (studentDept?.classes?.department_id !== departmentId) {
        throw new NotFoundException({
          message: 'Higher-education profile not found in your department.',
          errorCode: 'PROFILE_NOT_FOUND',
        });
      }

      const name = record.students.soa_applications
        ? `${record.students.soa_applications.first_name} ${record.students.soa_applications.last_name ?? ''}`.trim()
        : '—';

      // Backlogs/credits earned — same subject_attempts pattern as
      // HodService/PrincipalExamsService's arrears logic, scoped to this
      // one student: a subject the student never passed counts as a
      // backlog; credits_earned sums the credits of every subject they DID
      // ever pass.
      const attempts = await this.prisma.$queryRaw<
        { subject_id: number; credits: number | null; ever_passed: boolean }[]
      >(Prisma.sql`
        SELECT esm.subject_id, sub.credits, BOOL_OR(gb.is_pass) AS ever_passed
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN subjects sub ON sub.id = esm.subject_id
        ${GRADE_LOOKUP}
        WHERE e.status = 'results_published' AND em.student_id = ${record.students.id}
        GROUP BY esm.subject_id, sub.credits
      `);
      const backlogs = attempts.filter((a) => !a.ever_passed).length;
      const creditsEarned = attempts
        .filter((a) => a.ever_passed)
        .reduce((sum, a) => sum + (a.credits ?? 0), 0);

      return {
        id: record.id,
        student: {
          id: record.students.id,
          name,
          photo_url: record.students.photo_url,
          student_id_no: record.students.student_id_no,
          department_code: record.students.classes?.departments.code ?? null,
          batch_label: record.students.classes?.batches.name ?? null,
          mobile:
            record.students.soa_applications?.student_contact ??
            record.students.users.phone ??
            null,
          email: record.students.users.email,
          guardian: null,
        },
        admission: {
          status: record.admission_status,
          is_abroad: !OVERSEAS_KEYWORD_EXCLUDE.includes(
            record.preferred_country.toLowerCase(),
          ),
          intake: record.intake_term,
        },
        academic: {
          cgpa: record.cgpa != null ? Number(record.cgpa) : null,
          percentage:
            record.percentage != null ? Number(record.percentage) : null,
          backlogs,
          credits_earned: creditsEarned,
        },
        programme: {
          course: record.preferred_course,
          university: record.preferred_university,
          country: record.preferred_country,
          intake: record.intake_term,
          statement_of_purpose: record.sop_status,
          recommendation: record.recommendation_status,
        },
        readiness: {
          research_output: record.research_output,
          internship: record.internship_details,
          passport: null,
          visa: record.visa_status,
        },
        timeline: {
          application_submitted: toDateOnly(record.application_submitted_date),
          test_score_reported: null,
          interview_date: toDateOnly(record.interview_date),
          offer_result: record.offer_status,
        },
        funding: {
          scholarship: record.scholarship_name,
          scholarship_value:
            record.scholarship_value != null
              ? Number(record.scholarship_value)
              : null,
          loan_funding: record.funding_source,
        },
        test_scores: record.test_scores_summary,
        remarks: record.remarks,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD higher-education profile', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
