import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

function yearLabel(semester: number | null): string | null {
  if (semester == null) return null;
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? null;
}

function toDateOnly(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** Same GRADE_LOOKUP formula as HodService/HodClassRecordsService — copied verbatim, not reinvented. */
const GRADE_LOOKUP = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT is_pass, grade_point FROM grade_bands gb2
    WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
    ORDER BY gb2.min_percentage DESC LIMIT 1
  ) gb ON true
`;

/**
 * GET /hod/class-records/student/:id (+meeting-notes) — a HOD-facing
 * student-360 view. Field-to-table mapping is copied directly from the real,
 * already-working Admin student-detail backend
 * (src/modules/admissions/students/students.service.ts's findOne/
 * getProfileDetails/getFamily/getLifecycle/getCertificates) rather than
 * reinvented — that controller is Admin-only so this re-queries the same
 * real tables under the HOD's own department-scoped guard instead of
 * extending/touching admin's controller. Every query sequential — Supabase's
 * session-mode pool caps at 15 connections (see HodService's own comments).
 */
@Injectable()
export class HodStudentProfileService {
  private readonly logger = new Logger(HodStudentProfileService.name);

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

  /** Verifies the student belongs to the caller's own department; returns the student's class_id for reuse. */
  private async assertOwnDepartmentStudent(
    departmentId: number,
    studentId: number,
  ): Promise<{ classId: number | null }> {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { classes: { select: { id: true, department_id: true } } },
    });
    if (!student || student.classes?.department_id !== departmentId) {
      throw new NotFoundException({
        message: 'Student not found in your department.',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return { classId: student.classes?.id ?? null };
  }

  async getProfile(user: JwtPayload, studentId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    await this.assertOwnDepartmentStudent(departmentId, studentId);

    try {
      const student = await this.prisma.students.findUnique({
        where: { id: studentId },
        select: {
          id: true,
          student_id_no: true,
          roll_no: true,
          register_no: true,
          admission_no: true,
          admission_type: true,
          admission_date: true,
          gender: true,
          date_of_birth: true,
          blood_group: true,
          mother_tongue: true,
          community: true,
          is_first_graduate: true,
          student_type: true,
          dayscholar_mode: true,
          photo_url: true,
          student_sensitive_info: {
            select: {
              aadhar_number: true,
              passport_number: true,
              passport_valid_until: true,
            },
          },
          classes: {
            select: {
              id: true,
              section: true,
              current_semester: true,
              department_id: true,
              departments: { select: { name: true, code: true } },
            },
          },
          batches: { select: { name: true } },
          courses: { select: { name: true } },
          quotas: { select: { name: true } },
          users: { select: { email: true } },
          soa_applications: {
            select: {
              first_name: true,
              last_name: true,
              student_email: true,
              student_contact: true,
              cutoff_physics: true,
              cutoff_chemistry: true,
              cutoff_maths: true,
            },
          },
          student_contacts: {
            select: {
              student_email1: true,
              student_email2: true,
              student_mobile: true,
            },
          },
          student_addresses: {
            select: {
              address_type: true,
              address_line: true,
              city: true,
              district: true,
              state: true,
              pincode: true,
            },
          },
          student_family_details: {
            select: {
              father_name: true,
              father_occupation: true,
              father_mobile: true,
              father_email: true,
              father_photo_url: true,
              father_annual_income: true,
              mother_name: true,
              mother_occupation: true,
              mother_mobile: true,
              mother_email: true,
              mother_photo_url: true,
              mother_annual_income: true,
              guardian_name: true,
              guardian_relationship: true,
              guardian_phone: true,
              guardian_email: true,
            },
          },
          student_certificates: {
            // certificate_type_id is now nullable — student_certificates also
            // holds IQAC's real skill-certification rows (platform/track/
            // score, no certificate_type_id). This profile's document list
            // stays scoped to actual administrative document types.
            where: { certificate_type_id: { not: null } },
            select: {
              id: true,
              is_available: true,
              certificate_types: { select: { name: true } },
            },
          },
        },
      });
      if (!student) {
        throw new NotFoundException({
          message: 'Student not found.',
          errorCode: 'STUDENT_NOT_FOUND',
        });
      }

      const name = student.soa_applications
        ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
        : null;

      // Advisor/mentor — this schema has one real per-class mentor concept
      // (class_mentors), not two distinct roles; both slots resolve to the
      // same latest-by-academic_year record rather than fabricating a
      // second, separate "advisor" relationship that doesn't exist.
      const mentorRow = student.classes
        ? await this.prisma.class_mentors.findFirst({
            where: { class_id: student.classes.id },
            orderBy: { academic_year: 'desc' },
            select: {
              faculty: {
                select: {
                  first_name: true,
                  last_name: true,
                  designation: true,
                },
              },
            },
          })
        : null;
      const mentor = mentorRow
        ? {
            name: `${mentorRow.faculty.first_name} ${mentorRow.faculty.last_name}`.trim(),
            designation: mentorRow.faculty.designation,
          }
        : null;

      // Attendance % (cumulative, real attendance_records).
      const [attendanceRow] = await this.prisma.$queryRaw<
        { pct: string | null }[]
      >(Prisma.sql`
        SELECT (COUNT(*) FILTER (WHERE status = 'present')::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pct
        FROM attendance_records WHERE student_id = ${studentId}
      `);
      const attendancePercent =
        attendanceRow?.pct != null
          ? Math.round(Number(attendanceRow.pct) * 10) / 10
          : null;

      // GPA per semester (credit-weighted) — real exam_marks/grade_bands, same formula used everywhere else in this module.
      const gpaRows = await this.prisma.$queryRaw<
        {
          semester: number;
          gpa: string | null;
          credits_earned: string | null;
          arrears: bigint;
        }[]
      >(Prisma.sql`
        WITH attempts AS (
          SELECT e.semester, esm.subject_id, sub.credits, gb.grade_point, gb.is_pass
          FROM exam_marks em
          JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
          JOIN exams e ON e.id = esm.exam_id
          JOIN subjects sub ON sub.id = esm.subject_id
          ${GRADE_LOOKUP}
          WHERE e.status = 'results_published' AND em.is_absent = false AND em.marks_obtained IS NOT NULL
            AND em.student_id = ${studentId}
        )
        SELECT semester,
          (SUM(grade_point * COALESCE(credits, 1)) FILTER (WHERE grade_point IS NOT NULL)
            / NULLIF(SUM(COALESCE(credits, 1)) FILTER (WHERE grade_point IS NOT NULL), 0))::text AS gpa,
          SUM(COALESCE(credits, 1)) FILTER (WHERE is_pass)::text AS credits_earned,
          COUNT(*) FILTER (WHERE is_pass IS NOT TRUE)::bigint AS arrears
        FROM attempts GROUP BY semester ORDER BY semester
      `);
      const semesterWiseGpa = gpaRows.map((r) => ({
        semester: r.semester,
        gpa: r.gpa != null ? Math.round(Number(r.gpa) * 100) / 100 : null,
        credits_earned: r.credits_earned != null ? Number(r.credits_earned) : 0,
        arrears: Number(r.arrears),
      }));
      const cgpaValues = semesterWiseGpa
        .map((r) => r.gpa)
        .filter((v): v is number => v != null);
      const cgpa =
        cgpaValues.length > 0
          ? Math.round(
              (cgpaValues.reduce((a, b) => a + b, 0) / cgpaValues.length) * 100,
            ) / 100
          : null;
      const totalArrears = semesterWiseGpa.reduce(
        (sum, r) => sum + r.arrears,
        0,
      );
      const currentSemGpa =
        semesterWiseGpa.find(
          (r) => r.semester === student.classes?.current_semester,
        )?.gpa ?? null;

      // Monthly attendance — real attendance_records grouped by calendar month.
      const monthlyRows = await this.prisma.$queryRaw<
        { month: string; pct: string | null }[]
      >(Prisma.sql`
        SELECT to_char(attendance_date, 'YYYY-MM') AS month,
          (COUNT(*) FILTER (WHERE status = 'present')::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pct
        FROM attendance_records WHERE student_id = ${studentId}
        GROUP BY month ORDER BY month
      `);
      const monthlyAttendance = monthlyRows.map((r) => ({
        month: r.month,
        percent: r.pct != null ? Math.round(Number(r.pct) * 10) / 10 : 0,
      }));

      // Current-semester subjects with marks — class_subjects for the
      // student's own current semester, joined to whatever exam_marks exist.
      const currentSubjects = student.classes?.current_semester
        ? await this.prisma.class_subjects.findMany({
            where: {
              class_id: student.classes.id,
              semester: student.classes.current_semester,
            },
            select: {
              subjects: {
                select: { id: true, name: true, subject_code: true },
              },
            },
          })
        : [];
      const subjectIds = currentSubjects.map((cs) => cs.subjects.id);
      const marksRows = subjectIds.length
        ? await this.prisma.$queryRaw<
            {
              subject_id: number;
              internal_obtained: string | null;
              internal_max: string | null;
              external_obtained: string | null;
              external_max: string | null;
              grade: string | null;
            }[]
          >(Prisma.sql`
            SELECT esm.subject_id,
              SUM(em.marks_obtained) FILTER (WHERE et.category = 'internal')::text AS internal_obtained,
              SUM(em.max_marks) FILTER (WHERE et.category = 'internal')::text AS internal_max,
              SUM(em.marks_obtained) FILTER (WHERE et.category != 'internal')::text AS external_obtained,
              SUM(em.max_marks) FILTER (WHERE et.category != 'internal')::text AS external_max,
              MAX(gb.grade_label) AS grade
            FROM exam_marks em
            JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
            JOIN exams e ON e.id = esm.exam_id
            JOIN exam_types et ON et.id = e.exam_type_id
            LEFT JOIN LATERAL (
              SELECT grade_label FROM grade_bands gb2
              WHERE gb2.min_percentage <= (CASE WHEN em.is_absent THEN 0 ELSE em.marks_obtained / NULLIF(em.max_marks, 0) * 100 END)
              ORDER BY gb2.min_percentage DESC LIMIT 1
            ) gb ON true
            WHERE em.student_id = ${studentId} AND esm.subject_id IN (${Prisma.join(subjectIds)})
              AND em.is_absent = false AND em.marks_obtained IS NOT NULL
            GROUP BY esm.subject_id
          `)
        : [];
      const marksBySubject = new Map(marksRows.map((r) => [r.subject_id, r]));
      const attendanceBySubjectRows = subjectIds.length
        ? await this.prisma.$queryRaw<
            { subject_id: number; pct: string | null }[]
          >(Prisma.sql`
            SELECT subject_id, (COUNT(*) FILTER (WHERE status = 'present')::numeric / NULLIF(COUNT(*), 0) * 100)::text AS pct
            FROM attendance_records
            WHERE student_id = ${studentId} AND subject_id IN (${Prisma.join(subjectIds)})
            GROUP BY subject_id
          `)
        : [];
      const attendanceBySubject = new Map(
        attendanceBySubjectRows.map((r) => [
          r.subject_id,
          r.pct != null ? Math.round(Number(r.pct) * 10) / 10 : null,
        ]),
      );
      const currentSemesterSubjects = currentSubjects.map((cs) => {
        const m = marksBySubject.get(cs.subjects.id);
        const internalObtained =
          m?.internal_obtained != null ? Number(m.internal_obtained) : null;
        const internalMax =
          m?.internal_max != null ? Number(m.internal_max) : null;
        const externalObtained =
          m?.external_obtained != null ? Number(m.external_obtained) : null;
        const externalMax =
          m?.external_max != null ? Number(m.external_max) : null;
        const totalObtained = (internalObtained ?? 0) + (externalObtained ?? 0);
        const totalMax = (internalMax ?? 0) + (externalMax ?? 0);
        return {
          subject_id: cs.subjects.id,
          name: cs.subjects.name,
          code: cs.subjects.subject_code,
          internal_obtained: internalObtained,
          internal_max: internalMax,
          external_obtained: externalObtained,
          external_max: externalMax,
          total_percent:
            totalMax > 0
              ? Math.round((totalObtained / totalMax) * 1000) / 10
              : null,
          grade: m?.grade ?? null,
          attendance_percent: attendanceBySubject.get(cs.subjects.id) ?? null,
        };
      });

      // Fees — real student_fee_demand_mapping.total_amount (already the
      // correct per-mapping total — see NoDueService's own comment on why
      // this column, not a re-sum of items, is the right total) minus
      // fee_payments.amount_paid.
      const feeMappings = await this.prisma.student_fee_demand_mapping.findMany(
        {
          where: { student_id: studentId },
          select: {
            total_amount: true,
            fee_payments: { select: { amount_paid: true } },
          },
        },
      );
      const feeTotal = feeMappings.reduce(
        (sum, m) => sum + Number(m.total_amount),
        0,
      );
      const feePaid = feeMappings.reduce(
        (sum, m) =>
          sum + m.fee_payments.reduce((s, p) => s + Number(p.amount_paid), 0),
        0,
      );
      const feeDue = Math.max(0, feeTotal - feePaid);
      const feeStatus =
        feeDue <= 0 ? 'paid' : feePaid > 0 ? 'partial' : 'pending';

      // Placement status — real student_drive_applications.
      const applications =
        await this.prisma.student_drive_applications.findMany({
          where: { student_id: studentId },
          select: { status: true },
        });
      const placementStatus = applications.some((a) => a.status === 'placed')
        ? 'placed'
        : applications.length > 0
          ? 'in_process'
          : 'unplaced';

      const permanentAddress = student.student_addresses.find(
        (a) => a.address_type === 'permanent',
      );
      const communicationAddress = student.student_addresses.find(
        (a) => a.address_type === 'temporary',
      );
      const family = student.student_family_details;

      return {
        student: {
          id: student.id,
          name,
          student_id_no: student.student_id_no,
          roll_no: student.roll_no,
          register_no: student.register_no,
          admission_no: student.admission_no,
          department_name: student.classes?.departments.name ?? null,
          department_code: student.classes?.departments.code ?? null,
          programme: student.courses?.name ?? null,
          section: student.classes?.section ?? null,
          semester: student.classes?.current_semester ?? null,
          year_label: yearLabel(student.classes?.current_semester ?? null),
          batch_label: student.batches?.name ?? null,
          admission_type: student.admission_type,
          admission_date: toDateOnly(student.admission_date),
          date_of_birth: toDateOnly(student.date_of_birth),
          gender: student.gender,
          blood_group: student.blood_group,
          mother_tongue: student.mother_tongue,
          community: student.community,
          quota_name: student.quotas?.name ?? null,
          is_first_graduate: student.is_first_graduate,
          residence: student.student_type
            ? {
                type:
                  student.student_type === 'hosteller'
                    ? ('hosteller' as const)
                    : ('day_scholar' as const),
                mode: student.dayscholar_mode,
              }
            : null,
          institute_email: student.users.email,
          personal_email:
            student.student_contacts?.student_email1 ??
            student.soa_applications?.student_email ??
            null,
          mobile:
            student.student_contacts?.student_mobile ??
            student.soa_applications?.student_contact ??
            null,
          photo_url: student.photo_url,
          aadhaar_masked: student.student_sensitive_info?.aadhar_number
            ? `XXXX XXXX ${student.student_sensitive_info.aadhar_number.slice(-4)}`
            : null,
          passport_number:
            student.student_sensitive_info?.passport_number ?? null,
          passport_valid_until: toDateOnly(
            student.student_sensitive_info?.passport_valid_until ?? null,
          ),
        },
        stats: {
          attendance_percent: attendancePercent,
          cgpa,
          percentage:
            currentSemGpa != null
              ? Math.round((currentSemGpa / 10) * 1000) / 10
              : null,
          arrears: totalArrears,
        },
        advisor: mentor,
        mentor,
        addresses: {
          permanent: permanentAddress
            ? {
                address_line: permanentAddress.address_line,
                city: permanentAddress.city,
                district: permanentAddress.district,
                state: permanentAddress.state,
                pincode: permanentAddress.pincode,
              }
            : null,
          communication: communicationAddress
            ? {
                address_line: communicationAddress.address_line,
                city: communicationAddress.city,
                district: communicationAddress.district,
                state: communicationAddress.state,
                pincode: communicationAddress.pincode,
              }
            : null,
        },
        family: family
          ? {
              father: family.father_name
                ? {
                    name: family.father_name,
                    occupation: family.father_occupation,
                    mobile: family.father_mobile,
                    email: family.father_email,
                    photo_url: family.father_photo_url,
                    annual_income:
                      family.father_annual_income != null
                        ? Number(family.father_annual_income)
                        : null,
                  }
                : null,
              mother: family.mother_name
                ? {
                    name: family.mother_name,
                    occupation: family.mother_occupation,
                    mobile: family.mother_mobile,
                    email: family.mother_email,
                    photo_url: family.mother_photo_url,
                    annual_income:
                      family.mother_annual_income != null
                        ? Number(family.mother_annual_income)
                        : null,
                  }
                : null,
            }
          : null,
        guardian: family?.guardian_name
          ? {
              relation: family.guardian_relationship
                ?.toLowerCase()
                .includes('mother')
                ? 'mother'
                : 'father',
              name: family.guardian_name,
              mobile: family.guardian_phone,
              email: family.guardian_email,
            }
          : null,
        entrance_cutoff: student.soa_applications
          ? {
              physics:
                student.soa_applications.cutoff_physics != null
                  ? Number(student.soa_applications.cutoff_physics)
                  : null,
              chemistry:
                student.soa_applications.cutoff_chemistry != null
                  ? Number(student.soa_applications.cutoff_chemistry)
                  : null,
              maths:
                student.soa_applications.cutoff_maths != null
                  ? Number(student.soa_applications.cutoff_maths)
                  : null,
            }
          : null,
        certificates: student.student_certificates.map((c) => ({
          id: c.id,
          name: c.certificate_types!.name,
          verified: c.is_available,
        })),
        semester_wise_gpa: semesterWiseGpa,
        monthly_attendance: monthlyAttendance,
        current_semester_subjects: currentSemesterSubjects,
        fees: {
          status: feeStatus,
          total: feeTotal,
          paid: feePaid,
          due: feeDue,
        },
        placement_status: placementStatus,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD student profile', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getMeetingNotes(user: JwtPayload, studentId: number) {
    const departmentId = await this.resolveDepartmentId(user);
    await this.assertOwnDepartmentStudent(departmentId, studentId);

    const notes = await this.prisma.student_meeting_notes.findMany({
      where: { student_id: studentId },
      orderBy: { meeting_date: 'desc' },
      select: {
        id: true,
        meeting_date: true,
        note: true,
        created_at: true,
        users: {
          select: {
            email: true,
            faculty: { select: { first_name: true, last_name: true } },
          },
        },
      },
    });
    return notes.map((n) => ({
      id: n.id,
      meeting_date: toDateOnly(n.meeting_date)!,
      note: n.note,
      recorded_by: n.users
        ? n.users.faculty
          ? `${n.users.faculty.first_name} ${n.users.faculty.last_name}`.trim()
          : n.users.email
        : null,
      created_at: n.created_at.toISOString(),
    }));
  }

  async addMeetingNote(
    user: JwtPayload,
    studentId: number,
    input: { meeting_date: string; note: string },
  ) {
    const departmentId = await this.resolveDepartmentId(user);
    await this.assertOwnDepartmentStudent(departmentId, studentId);

    if (!input.note || !input.note.trim()) {
      throw new BadRequestException({
        message: 'Note text is required.',
        errorCode: 'VALIDATION_ERROR',
      });
    }

    const created = await this.prisma.student_meeting_notes.create({
      data: {
        student_id: studentId,
        meeting_date: new Date(input.meeting_date),
        note: input.note.trim(),
        recorded_by_user_id: user.sub,
      },
      select: {
        id: true,
        meeting_date: true,
        note: true,
        created_at: true,
        users: {
          select: {
            email: true,
            faculty: { select: { first_name: true, last_name: true } },
          },
        },
      },
    });
    return {
      id: created.id,
      meeting_date: toDateOnly(created.meeting_date)!,
      note: created.note,
      recorded_by: created.users
        ? created.users.faculty
          ? `${created.users.faculty.first_name} ${created.users.faculty.last_name}`.trim()
          : created.users.email
        : null,
      created_at: created.created_at.toISOString(),
    };
  }
}
