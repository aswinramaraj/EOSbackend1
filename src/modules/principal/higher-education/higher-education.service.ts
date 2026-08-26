import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { ListHigherEducationQueryDto } from './dto/list-higher-education-query.dto';

/** Same GRADE_LOOKUP formula as PrincipalStudentsService/PrincipalExamsService/HodClassRecordsService — copied verbatim, not reinvented. */
const GRADE_LOOKUP = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT is_pass FROM grade_bands gb2
    WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
    ORDER BY gb2.min_percentage DESC
    LIMIT 1
  ) gb ON true
`;

@Injectable()
export class PrincipalHigherEducationService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /me/principal/higher-education/filters — real batches/departments only. */
  async filters() {
    const [batches, departments] = await Promise.all([
      this.prisma.batches.findMany({
        select: { id: true, name: true },
        orderBy: { start_year: 'desc' },
      }),
      this.prisma.departments.findMany({
        select: { id: true, name: true, code: true },
        orderBy: { name: 'asc' },
      }),
    ]);
    return { batches, departments };
  }

  /**
   * GET /me/principal/higher-education/summary
   *
   * "Overseas" is derived as `preferred_country` not case-insensitively
   * equal to "India" (no is_abroad flag exists). `is_scholarship`/
   * `admission_status` are real columns (synced into schema.prisma), read
   * via the typed client directly now — no fallback needed.
   */
  async summary() {
    const rows = await this.prisma.student_higher_education.findMany({
      select: {
        id: true,
        preferred_country: true,
        is_scholarship: true,
        admission_status: true,
      },
    });
    const overseas = rows.filter(
      (r) => r.preferred_country.trim().toLowerCase() !== 'india',
    ).length;
    const countries = new Set(
      rows
        .filter((r) => r.preferred_country.trim().toLowerCase() !== 'india')
        .map((r) => r.preferred_country.trim()),
    );

    const scholarshipCount = rows.filter(
      (r) => r.is_scholarship === true,
    ).length;
    const confirmedAdmissionCount = rows.filter(
      (r) =>
        r.admission_status === 'admitted' || r.admission_status === 'enrolled',
    ).length;

    return {
      total: rows.length,
      within_india: rows.length - overseas,
      overseas,
      countries_count: countries.size,
      countries: Array.from(countries).sort(),
      scholarship_count: scholarshipCount,
      confirmed_admission_count: confirmedAdmissionCount,
    };
  }

  /**
   * GET /me/principal/higher-education
   *
   * Only 2 real rows exist today — fetches everything matching the filters,
   * no server pagination, same tradeoff as Students/Faculty.
   */
  async list(query: ListHigherEducationQueryDto) {
    const rows = await this.prisma.student_higher_education.findMany({
      select: {
        id: true,
        preferred_course: true,
        preferred_country: true,
        preferred_university: true,
        remarks: true,
        is_scholarship: true,
        scholarship_name: true,
        admission_status: true,
        students: {
          select: {
            id: true,
            register_no: true,
            roll_no: true,
            batch_id: true,
            batches: { select: { id: true, name: true } },
            classes: {
              select: {
                section: true,
                current_semester: true,
                department_id: true,
                departments: { select: { id: true, name: true, code: true } },
              },
            },
            courses: {
              select: {
                departments: { select: { id: true, name: true, code: true } },
              },
            },
            users: { select: { email: true } },
            soa_applications: {
              select: { first_name: true, last_name: true },
            },
          },
        },
      },
      orderBy: { id: 'desc' },
    });

    const records = rows
      .map((row) => {
        const student = row.students;
        const department =
          student.classes?.departments ?? student.courses?.departments ?? null;
        const name =
          student.soa_applications?.first_name ||
          student.soa_applications?.last_name
            ? [
                student.soa_applications?.first_name,
                student.soa_applications?.last_name,
              ]
                .filter(Boolean)
                .join(' ')
            : student.users.email;
        const semester = student.classes?.current_semester ?? null;

        return {
          id: row.id,
          student: {
            id: student.id,
            name,
            register_no: student.register_no,
            roll_no: student.roll_no,
          },
          batch: student.batches,
          department,
          section: student.classes?.section ?? null,
          year: semester != null ? Math.ceil(semester / 2) : null,
          programme: row.preferred_course,
          university: row.preferred_university,
          country: row.preferred_country,
          is_abroad: row.preferred_country.trim().toLowerCase() !== 'india',
          remarks: row.remarks,
          is_scholarship: row.is_scholarship,
          scholarship_name: row.scholarship_name,
          admission_status: row.admission_status,
        };
      })
      .filter((r) => {
        if (query.batch_id && r.batch?.id !== query.batch_id) return false;
        if (query.department_id && r.department?.id !== query.department_id)
          return false;
        if (query.q) {
          const q = query.q.toLowerCase();
          const haystack = [
            r.student.name,
            r.student.register_no,
            r.student.roll_no,
            r.programme,
            r.university,
            r.country,
            r.department?.name,
            r.department?.code,
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          if (!haystack.includes(q)) return false;
        }
        return true;
      });

    return { total: records.length, records };
  }

  /**
   * GET /me/principal/higher-education/:id/profile — full detail screen for
   * one student_higher_education row. Every field maps to a real column on
   * `student_higher_education` itself, or to the same real family/contact
   * data the Student Profile screen already uses. Two things from the
   * reference design have no backing anywhere in the schema and are left
   * out rather than fabricated: a passport *expiry* date (student_sensitive_
   * info.passport_number exists, no expiry column) and a named "hostel
   * warden"-style contact for this flow. `credits_earned`/`arrear_count`
   * are computed live from real exam_marks (same grade_bands.is_pass rule
   * PrincipalStudentsService.getStudentProfile()'s gpa_history uses) rather
   * than read from a stored total.
   */
  async getProfile(id: number) {
    const row = await this.prisma.student_higher_education.findUnique({
      where: { id },
      select: {
        id: true,
        preferred_course: true,
        preferred_country: true,
        preferred_university: true,
        remarks: true,
        is_scholarship: true,
        scholarship_name: true,
        scholarship_value: true,
        admission_status: true,
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
        cgpa: true,
        percentage: true,
        test_scores_summary: true,
        students: {
          select: {
            id: true,
            register_no: true,
            roll_no: true,
            photo_url: true,
            batches: { select: { id: true, name: true } },
            classes: {
              select: { departments: { select: { id: true, name: true, code: true } } },
            },
            courses: {
              select: { departments: { select: { id: true, name: true, code: true } } },
            },
            users: { select: { email: true } },
            soa_applications: { select: { first_name: true, last_name: true } },
            student_contacts: { select: { student_mobile: true } },
            student_sensitive_info: { select: { passport_number: true } },
            student_family_details: true,
          },
        },
      },
    });

    if (!row) {
      throw new InternalServerErrorException({
        message: 'Higher-education record not found',
        errorCode: 'HIGHER_EDUCATION_NOT_FOUND',
      });
    }

    const student = row.students;
    const department = student.classes?.departments ?? student.courses?.departments ?? null;
    const name =
      student.soa_applications?.first_name || student.soa_applications?.last_name
        ? [student.soa_applications?.first_name, student.soa_applications?.last_name].filter(Boolean).join(' ')
        : student.users.email;

    const creditsRows = await this.prisma.$queryRaw<{ arrear_count: bigint; credits_earned: bigint | null }[]>(
      Prisma.sql`
        WITH subject_attempts AS (
          SELECT esm.subject_id, COALESCE(sub.credits, 1) AS credits, BOOL_OR(gb.is_pass) AS ever_passed
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          JOIN subjects sub ON sub.id = esm.subject_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published' AND em.student_id = ${student.id}
          GROUP BY esm.subject_id, sub.credits
        )
        SELECT
          COUNT(*) FILTER (WHERE ever_passed IS NOT TRUE)::bigint AS arrear_count,
          COALESCE(SUM(credits) FILTER (WHERE ever_passed = true), 0)::bigint AS credits_earned
        FROM subject_attempts
      `,
    );
    const arrearCount = Number(creditsRows[0]?.arrear_count ?? 0);
    const creditsEarned = Number(creditsRows[0]?.credits_earned ?? 0);

    const family = student.student_family_details;

    return {
      id: row.id,
      student: {
        id: student.id,
        name,
        register_no: student.register_no,
        roll_no: student.roll_no,
        photo_url: student.photo_url,
        institute_email: student.users.email,
        mobile: student.student_contacts?.student_mobile ?? null,
        passport_number: student.student_sensitive_info?.passport_number ?? null,
      },
      batch: student.batches,
      department,
      programme: row.preferred_course,
      university: row.preferred_university,
      country: row.preferred_country,
      is_abroad: row.preferred_country.trim().toLowerCase() !== 'india',
      intake_term: row.intake_term,
      sop_status: row.sop_status,
      recommendation_status: row.recommendation_status,
      research_output: row.research_output,
      internship_details: row.internship_details,
      visa_status: row.visa_status,
      application_submitted_date: row.application_submitted_date,
      interview_date: row.interview_date,
      offer_status: row.offer_status,
      funding_source: row.funding_source,
      cgpa: row.cgpa ? Number(row.cgpa) : null,
      percentage: row.percentage ? Number(row.percentage) : null,
      test_scores_summary: row.test_scores_summary,
      is_scholarship: row.is_scholarship,
      scholarship_name: row.scholarship_name,
      scholarship_value: row.scholarship_value ? Number(row.scholarship_value) : null,
      admission_status: row.admission_status,
      remarks: row.remarks,
      credits_earned: creditsEarned,
      arrear_count: arrearCount,
      family: family
        ? {
            father: {
              name: family.father_name,
              occupation: family.father_occupation,
              mobile: family.father_mobile,
              email: family.father_email,
              photo_url: family.father_photo_url,
            },
            mother: {
              name: family.mother_name,
              occupation: family.mother_occupation,
              mobile: family.mother_mobile,
              email: family.mother_email,
              photo_url: family.mother_photo_url,
            },
            guardian: family.guardian_name
              ? {
                  name: family.guardian_name,
                  relationship: family.guardian_relationship,
                  is_father: false,
                  mobile: family.guardian_phone,
                  email: family.guardian_email,
                }
              : {
                  name: family.father_name,
                  relationship: 'Father',
                  is_father: true,
                  mobile: family.father_mobile,
                  email: family.father_email,
                },
          }
        : null,
    };
  }
}
