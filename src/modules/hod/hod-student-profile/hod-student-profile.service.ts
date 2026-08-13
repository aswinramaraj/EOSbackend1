import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import {
  computeGpa,
  isPassingPercentage,
  percentageToGrade,
} from '../shared/grade-scale.util';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

const MONTH_LABELS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function toPercentage(marksObtained: unknown, maxMarks: unknown): number {
  const scored = Number(marksObtained);
  const max = Number(maxMarks);
  return max > 0 ? (scored / max) * 100 : 0;
}

function studentName(
  soa: { first_name: string; last_name: string | null } | null,
): string | null {
  if (!soa) return null;
  return (
    [soa.first_name, soa.last_name].filter(Boolean).join(' ').trim() || null
  );
}

function fullName(p: { first_name: string; last_name: string | null }): string {
  return [p.first_name, p.last_name].filter(Boolean).join(' ');
}

type DueStatus = 'paid' | 'partial' | 'pending';
function dueStatusOf(total: Prisma.Decimal, paid: Prisma.Decimal): DueStatus {
  if (paid.greaterThanOrEqualTo(total) && total.greaterThan(0)) return 'paid';
  if (paid.greaterThan(0)) return 'partial';
  return 'pending';
}
function clampNonNegative(value: Prisma.Decimal): Prisma.Decimal {
  return value.isNegative() ? new Prisma.Decimal(0) : value;
}

@Injectable()
export class HodStudentProfileService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves the caller's own faculty row + department — never trusts a client-supplied department_id. */
  private async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /** GET /hod/class-records/student/:id */
  async getProfile(userId: number, studentId: number) {
    const hod = await this.resolveHodDepartment(userId);

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        student_id_no: true,
        roll_no: true,
        register_no: true,
        admission_no: true,
        admission_date: true,
        admission_type: true,
        joined_academic_year: true,
        gender: true,
        date_of_birth: true,
        dayscholar_mode: true,
        is_first_graduate: true,
        mother_tongue: true,
        blood_group: true,
        community: true,
        photo_url: true,
        soa_applications: {
          select: {
            first_name: true,
            last_name: true,
            cutoff_physics: true,
            cutoff_chemistry: true,
            cutoff_maths: true,
          },
        },
        student_sensitive_info: {
          select: {
            aadhar_number: true,
            passport_number: true,
            passport_valid_until: true,
          },
        },
        faculty: {
          select: { prefix: true, first_name: true, last_name: true, designation: true },
        },
        users: { select: { email: true } },
        quotas: { select: { name: true } },
        courses: { select: { name: true, code: true, duration_years: true } },
        classes: {
          select: {
            id: true,
            section: true,
            current_semester: true,
            department_id: true,
            departments: { select: { name: true, code: true } },
            batches: { select: { start_year: true, end_year: true } },
          },
        },
        student_contacts: {
          select: {
            student_email1: true,
            student_email2: true,
            student_mobile: true,
          },
        },
        student_family_details: true,
        student_addresses: {
          select: {
            address_type: true,
            address_line: true,
            city: true,
            state: true,
            pincode: true,
            district: true,
          },
        },
      },
    });
    if (!student || student.classes?.department_id !== hod.department_id) {
      throw new ForbiddenException('This student is not in your department');
    }

    const semester = student.classes?.current_semester ?? null;
    const classId = student.classes?.id ?? null;

    const [
      advisor,
      allMarks,
      attendanceRows,
      currentSemesterSubjects,
      monthlyAttendance,
      feeInfo,
      placementStatus,
      hostelMapping,
      certificates,
    ] = await Promise.all([
      classId
        ? this.prisma.class_mentors.findFirst({
            where: { class_id: classId },
            orderBy: { academic_year: 'desc' },
            select: {
              faculty: {
                select: {
                  prefix: true,
                  first_name: true,
                  last_name: true,
                  designation: true,
                },
              },
            },
          })
        : null,
      this.getAllExternalMarks(studentId),
      this.getAttendanceTotals(studentId),
      classId && semester != null
        ? this.getCurrentSemesterSubjects(studentId, classId, semester)
        : [],
      this.getMonthlyAttendance(studentId),
      this.getFeeInfo(studentId),
      this.getPlacementStatus(studentId),
      this.prisma.student_hostel_mapping.findUnique({
        where: { student_id: studentId },
        select: { id: true },
      }),
      this.prisma.student_certificates.findMany({
        where: { student_id: studentId, is_available: true },
        select: {
          id: true,
          verified_at: true,
          certificate_types: { select: { name: true } },
        },
      }),
    ]);

    const gradedMarks = allMarks.filter(
      (m) => !m.is_absent && m.marks_obtained != null,
    );
    const cgpa = computeGpa(
      gradedMarks.map((m) => ({
        percentage: m.percentage,
        credits: m.credits,
      })),
    );
    const overallArrears = allMarks.filter(
      (m) => m.is_absent || !isPassingPercentage(m.percentage),
    ).length;

    const attendancePercent =
      attendanceRows.total > 0
        ? Math.round((attendanceRows.present / attendanceRows.total) * 1000) /
          10
        : null;

    const semesterGroups = new Map<number, typeof allMarks>();
    for (const m of allMarks) {
      const list = semesterGroups.get(m.semester) ?? [];
      list.push(m);
      semesterGroups.set(m.semester, list);
    }
    const semesterWiseGpa = [...semesterGroups.entries()]
      .sort(([a], [b]) => a - b)
      .map(([sem, marks]) => {
        const graded = marks.filter(
          (m) => !m.is_absent && m.marks_obtained != null,
        );
        const gpa = computeGpa(
          graded.map((m) => ({ percentage: m.percentage, credits: m.credits })),
        );
        const creditsEarned = graded
          .filter((m) => isPassingPercentage(m.percentage))
          .reduce((sum, m) => sum + (m.credits ?? 0), 0);
        const arrears = marks.filter(
          (m) => m.is_absent || !isPassingPercentage(m.percentage),
        ).length;
        return { semester: sem, gpa, credits_earned: creditsEarned, arrears };
      });

    const father = student.student_family_details;

    // "Primary guardian" is a display convenience, not a real column — no
    // guardian concept distinct from father/mother exists anywhere in the
    // schema (see query.md). Father is preferred when present, matching the
    // reference design's own "Guardian: Same as father" default.
    const primaryGuardian = father?.father_name
      ? {
          relation: 'father' as const,
          name: father.father_name,
          mobile: father.father_mobile,
          email: father.father_email,
        }
      : father?.mother_name
        ? {
            relation: 'mother' as const,
            name: father.mother_name,
            mobile: father.mother_mobile,
            email: father.mother_email,
          }
        : null;

    const aadhar = student.student_sensitive_info?.aadhar_number ?? null;
    const maskedAadhaar = aadhar ? `XXXX XXXX ${aadhar.slice(-4)}` : null;

    const soa = student.soa_applications;
    const entranceCutoff =
      soa &&
      (soa.cutoff_physics != null ||
        soa.cutoff_chemistry != null ||
        soa.cutoff_maths != null)
        ? {
            physics:
              soa.cutoff_physics != null ? Number(soa.cutoff_physics) : null,
            chemistry:
              soa.cutoff_chemistry != null
                ? Number(soa.cutoff_chemistry)
                : null,
            maths: soa.cutoff_maths != null ? Number(soa.cutoff_maths) : null,
          }
        : null;

    const permanentAddress =
      student.student_addresses.find((a) => a.address_type === 'permanent') ??
      null;
    const temporaryAddress =
      student.student_addresses.find((a) => a.address_type === 'temporary') ??
      null;

    return {
      student: {
        id: student.id,
        name: studentName(student.soa_applications),
        student_id_no: student.student_id_no,
        roll_no: student.roll_no,
        register_no: student.register_no,
        admission_no: student.admission_no,
        department_name: student.classes?.departments?.name ?? null,
        department_code: student.classes?.departments?.code ?? null,
        programme: student.courses ? `${student.courses.name}` : null,
        section: student.classes?.section ?? null,
        semester,
        year_label: semester != null ? yearLabelForSemester(semester) : null,
        batch_label: student.classes?.batches
          ? `${student.classes.batches.start_year} - ${student.classes.batches.end_year}`
          : null,
        admission_type: student.admission_type,
        admission_date:
          student.admission_date?.toISOString().slice(0, 10) ?? null,
        date_of_birth:
          student.date_of_birth?.toISOString().slice(0, 10) ?? null,
        gender: student.gender,
        blood_group: student.blood_group,
        mother_tongue: student.mother_tongue,
        community: student.community,
        quota_name: student.quotas?.name ?? null,
        is_first_graduate: student.is_first_graduate,
        residence:
          student.dayscholar_mode != null
            ? { type: 'day_scholar' as const, mode: student.dayscholar_mode }
            : hostelMapping
              ? { type: 'hosteller' as const, mode: null }
              : null,
        institute_email: student.users.email,
        personal_email:
          student.student_contacts?.student_email2 ??
          student.student_contacts?.student_email1 ??
          null,
        mobile: student.student_contacts?.student_mobile ?? null,
        photo_url: student.photo_url,
        aadhaar_masked: maskedAadhaar,
        passport_number: student.student_sensitive_info?.passport_number ?? null,
        passport_valid_until:
          student.student_sensitive_info?.passport_valid_until
            ?.toISOString()
            .slice(0, 10) ?? null,
      },
      stats: {
        attendance_percent: attendancePercent,
        cgpa,
        percentage: cgpa != null ? Math.round(cgpa * 9.5 * 10) / 10 : null,
        arrears: overallArrears,
      },
      advisor: advisor
        ? {
            name: fullName(advisor.faculty),
            designation: advisor.faculty.designation,
          }
        : null,
      mentor: student.faculty
        ? {
            name: fullName(student.faculty),
            designation: student.faculty.designation,
          }
        : null,
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
        communication: temporaryAddress
          ? {
              address_line: temporaryAddress.address_line,
              city: temporaryAddress.city,
              district: temporaryAddress.district,
              state: temporaryAddress.state,
              pincode: temporaryAddress.pincode,
            }
          : null,
      },
      family: father
        ? {
            father: father.father_name
              ? {
                  name: father.father_name,
                  occupation: father.father_occupation,
                  mobile: father.father_mobile,
                  email: father.father_email,
                  photo_url: father.father_photo_url,
                  annual_income:
                    father.father_annual_income != null
                      ? Number(father.father_annual_income)
                      : null,
                }
              : null,
            mother: father.mother_name
              ? {
                  name: father.mother_name,
                  occupation: father.mother_occupation,
                  mobile: father.mother_mobile,
                  email: father.mother_email,
                  photo_url: father.mother_photo_url,
                  annual_income:
                    father.mother_annual_income != null
                      ? Number(father.mother_annual_income)
                      : null,
                }
              : null,
          }
        : null,
      guardian: primaryGuardian,
      entrance_cutoff: entranceCutoff,
      certificates: certificates.map((c) => ({
        id: c.id,
        name: c.certificate_types.name,
        verified: c.verified_at != null,
      })),
      semester_wise_gpa: semesterWiseGpa,
      monthly_attendance: monthlyAttendance,
      current_semester_subjects: currentSemesterSubjects,
      fees: feeInfo,
      placement_status: placementStatus,
    };
  }

  private async getAllExternalMarks(studentId: number) {
    const rows = await this.prisma.exam_marks.findMany({
      where: {
        student_id: studentId,
        exam_subject_mapping: {
          exams: { exam_types: { category: 'external' } },
        },
      },
      select: {
        marks_obtained: true,
        max_marks: true,
        is_absent: true,
        exam_subject_mapping: {
          select: {
            subjects: { select: { credits: true } },
            exams: { select: { semester: true } },
          },
        },
      },
    });
    return rows.map((row) => ({
      is_absent: row.is_absent,
      percentage: toPercentage(row.marks_obtained, row.max_marks),
      credits: row.exam_subject_mapping.subjects.credits,
      semester: row.exam_subject_mapping.exams.semester,
      marks_obtained: row.marks_obtained,
    }));
  }

  private async getAttendanceTotals(studentId: number) {
    const rows = await this.prisma.attendance_records.groupBy({
      by: ['status'],
      where: { student_id: studentId },
      _count: { _all: true },
    });
    let present = 0;
    let total = 0;
    for (const row of rows) {
      total += row._count._all;
      if (row.status === 'present') present += row._count._all;
    }
    return { present, total };
  }

  private async getMonthlyAttendance(studentId: number) {
    const rows = await this.prisma.attendance_records.findMany({
      where: { student_id: studentId },
      select: { attendance_date: true, status: true },
    });
    const byMonth = new Map<string, { present: number; total: number }>();
    for (const row of rows) {
      const key = row.attendance_date.toISOString().slice(0, 7);
      const entry = byMonth.get(key) ?? { present: 0, total: 0 };
      entry.total += 1;
      if (row.status === 'present') entry.present += 1;
      byMonth.set(key, entry);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => ({
        month: MONTH_LABELS[Number(key.slice(5, 7)) - 1],
        percent: v.total > 0 ? Math.round((v.present / v.total) * 100) : 0,
      }));
  }

  /** Per-subject latest internal + external marks and subject-wise attendance, for the student's current class/semester. */
  private async getCurrentSemesterSubjects(
    studentId: number,
    classId: number,
    semester: number,
  ) {
    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { class_id: classId, exams: { semester } },
      select: {
        id: true,
        subjects: { select: { id: true, name: true, subject_code: true } },
        exams: {
          select: {
            id: true,
            created_at: true,
            exam_types: { select: { category: true } },
          },
        },
        exam_marks: {
          where: { student_id: studentId },
          select: { marks_obtained: true, max_marks: true, is_absent: true },
        },
      },
      orderBy: { id: 'asc' },
    });

    const bySubject = new Map<number, typeof mappings>();
    for (const m of mappings) {
      const list = bySubject.get(m.subjects.id) ?? [];
      list.push(m);
      bySubject.set(m.subjects.id, list);
    }

    const attendanceRows = await this.prisma.attendance_records.groupBy({
      by: ['subject_id', 'status'],
      where: {
        student_id: studentId,
        class_id: classId,
        subject_id: { not: null },
      },
      _count: { _all: true },
    });
    const attendanceBySubject = new Map<
      number,
      { present: number; total: number }
    >();
    for (const row of attendanceRows) {
      if (row.subject_id == null) continue;
      const entry = attendanceBySubject.get(row.subject_id) ?? {
        present: 0,
        total: 0,
      };
      entry.total += row._count._all;
      if (row.status === 'present') entry.present += row._count._all;
      attendanceBySubject.set(row.subject_id, entry);
    }

    return [...bySubject.entries()].map(([subjectId, subjectMappings]) => {
      const internal = subjectMappings
        .filter(
          (m) => m.exams.exam_types.category === 'internal' && m.exam_marks[0],
        )
        .sort(
          (a, b) => b.exams.created_at.getTime() - a.exams.created_at.getTime(),
        )[0];
      const external = subjectMappings.find(
        (m) => m.exams.exam_types.category === 'external' && m.exam_marks[0],
      );
      const internalMark = internal?.exam_marks[0] ?? null;
      const externalMark = external?.exam_marks[0] ?? null;

      const combinedObtained =
        (internalMark && !internalMark.is_absent
          ? Number(internalMark.marks_obtained ?? 0)
          : 0) +
        (externalMark && !externalMark.is_absent
          ? Number(externalMark.marks_obtained ?? 0)
          : 0);
      const combinedMax =
        (internalMark ? Number(internalMark.max_marks) : 0) +
        (externalMark ? Number(externalMark.max_marks) : 0);
      const totalPercent =
        combinedMax > 0
          ? Math.round((combinedObtained / combinedMax) * 1000) / 10
          : null;
      const grade =
        totalPercent != null ? percentageToGrade(totalPercent).grade : null;

      const attendance = attendanceBySubject.get(subjectId);
      const attendancePercent =
        attendance && attendance.total > 0
          ? Math.round((attendance.present / attendance.total) * 100)
          : null;

      const subject = subjectMappings[0].subjects;
      return {
        subject_id: subjectId,
        name: subject.name,
        code: subject.subject_code,
        internal_obtained:
          internalMark && !internalMark.is_absent
            ? Number(internalMark.marks_obtained)
            : null,
        internal_max: internalMark ? Number(internalMark.max_marks) : null,
        external_obtained:
          externalMark && !externalMark.is_absent
            ? Number(externalMark.marks_obtained)
            : null,
        external_max: externalMark ? Number(externalMark.max_marks) : null,
        total_percent: totalPercent,
        grade,
        attendance_percent: attendancePercent,
      };
    });
  }

  /** Same live-recomputed total/paid/outstanding pattern as hod-class-records.service.ts. */
  private async getFeeInfo(studentId: number) {
    const mappings = await this.prisma.student_fee_demand_mapping.findMany({
      where: { student_id: studentId },
      select: {
        fee_payments: { select: { amount_paid: true } },
        fee_structures: {
          select: { fee_structure_items: { select: { amount: true } } },
        },
      },
    });
    if (mappings.length === 0)
      return { status: 'paid' as DueStatus, total: 0, paid: 0, due: 0 };

    let total = new Prisma.Decimal(0);
    let paid = new Prisma.Decimal(0);
    let anyPending = false;
    let anyPartial = false;
    for (const m of mappings) {
      const t = m.fee_structures.fee_structure_items.reduce(
        (sum, item) => sum.plus(item.amount),
        new Prisma.Decimal(0),
      );
      const p = m.fee_payments.reduce(
        (sum, fp) => sum.plus(fp.amount_paid),
        new Prisma.Decimal(0),
      );
      total = total.plus(t);
      paid = paid.plus(p);
      const status = dueStatusOf(t, p);
      if (status === 'pending') anyPending = true;
      if (status === 'partial') anyPartial = true;
    }
    return {
      status: anyPending ? 'pending' : anyPartial ? 'partial' : 'paid',
      total: total.toNumber(),
      paid: paid.toNumber(),
      due: clampNonNegative(total.minus(paid)).toNumber(),
    };
  }

  private async assertStudentInDepartment(
    studentId: number,
    departmentId: number,
  ) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { classes: { select: { department_id: true } } },
    });
    if (!student || student.classes?.department_id !== departmentId) {
      throw new ForbiddenException('This student is not in your department');
    }
  }

  /** GET /hod/class-records/student/:id/meeting-notes */
  async getMeetingNotes(userId: number, studentId: number) {
    const hod = await this.resolveHodDepartment(userId);
    await this.assertStudentInDepartment(studentId, hod.department_id);

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
      meeting_date: n.meeting_date.toISOString().slice(0, 10),
      note: n.note,
      recorded_by: n.users
        ? n.users.faculty
          ? fullName(n.users.faculty)
          : n.users.email
        : null,
      created_at: n.created_at,
    }));
  }

  /** POST /hod/class-records/student/:id/meeting-notes */
  async addMeetingNote(
    userId: number,
    studentId: number,
    meetingDate: string,
    note: string,
  ) {
    const hod = await this.resolveHodDepartment(userId);
    await this.assertStudentInDepartment(studentId, hod.department_id);

    const created = await this.prisma.student_meeting_notes.create({
      data: {
        student_id: studentId,
        meeting_date: new Date(meetingDate),
        note,
        recorded_by_user_id: userId,
      },
      select: { id: true, meeting_date: true, note: true, created_at: true },
    });

    return {
      id: created.id,
      meeting_date: created.meeting_date.toISOString().slice(0, 10),
      note: created.note,
      created_at: created.created_at,
    };
  }

  private async getPlacementStatus(studentId: number) {
    const apps = await this.prisma.student_drive_applications.findMany({
      where: { student_id: studentId },
      select: { status: true },
    });
    if (apps.some((a) => a.status === 'placed')) return 'placed';
    if (apps.some((a) => a.status !== 'rejected')) return 'in_process';
    return 'unplaced';
  }
}
