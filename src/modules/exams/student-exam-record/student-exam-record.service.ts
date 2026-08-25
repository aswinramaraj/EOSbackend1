import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const ATTENDANCE_THRESHOLD_PCT = 75;

const STUDENT_LIST_SELECT = {
  id: true,
  register_no: true,
  student_id_no: true,
  roll_no: true,
  status: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  classes: {
    select: {
      current_semester: true,
      section: true,
      department_id: true,
      departments: { select: { id: true, code: true, name: true } },
      courses: { select: { name: true } },
    },
  },
} as const;

function studentDisplayName(s: { soa_applications: { first_name: string; last_name: string | null } | null }): string | null {
  if (!s.soa_applications) return null;
  return [s.soa_applications.first_name, s.soa_applications.last_name].filter(Boolean).join(' ') || null;
}

@Injectable()
export class StudentExamRecordService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /student-exam-record — real, filterable roster (department/semester/search) backing the listing page. */
  async list(query: { department_id?: number; semester?: number; search?: string }) {
    const students = await this.prisma.students.findMany({
      where: {
        status: 'active',
        ...(query.department_id ? { classes: { department_id: query.department_id } } : {}),
        ...(query.semester ? { classes: { current_semester: query.semester } } : {}),
        ...(query.search
          ? {
              OR: [
                { register_no: { contains: query.search, mode: 'insensitive' } },
                { student_id_no: { contains: query.search, mode: 'insensitive' } },
                { roll_no: { contains: query.search, mode: 'insensitive' } },
                { soa_applications: { first_name: { contains: query.search, mode: 'insensitive' } } },
                { soa_applications: { last_name: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      select: STUDENT_LIST_SELECT,
      orderBy: { register_no: 'asc' },
      take: 200,
    });

    return students.map((s) => ({
      id: s.id,
      register_no: s.register_no ?? s.student_id_no,
      name: studentDisplayName(s),
      department: s.classes?.departments ?? null,
      programme: s.classes?.courses?.name ?? null,
      semester: s.classes?.current_semester ?? null,
      section: s.classes?.section ?? null,
    }));
  }

  /** Same class+subject, an internal-category exam, same academic year/semester — mirrors marks-roster.service.ts's real internal/external join. */
  private async findInternalMapping(classId: number, subjectId: number, academicYear: string, semester: number, excludeMappingId: number) {
    return this.prisma.exam_subject_mapping.findFirst({
      where: {
        class_id: classId,
        subject_id: subjectId,
        id: { not: excludeMappingId },
        exams: { academic_year: academicYear, semester, exam_types: { category: 'internal' } },
      },
      orderBy: { exam_id: 'desc' },
      select: { id: true },
    });
  }

  /** GET /student-exam-record/:studentId — the full real profile matching the design 1:1. */
  async getRecord(studentId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        register_no: true,
        student_id_no: true,
        status: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        classes: {
          select: {
            current_semester: true,
            section: true,
            department_id: true,
            departments: { select: { id: true, code: true, name: true } },
            courses: { select: { name: true } },
            batches: { select: { start_year: true, name: true } },
          },
        },
      },
    });
    if (!student) throw new NotFoundException({ message: 'Student not found.', errorCode: 'STUDENT_NOT_FOUND' });

    const [rules, gradeBands, marks, registrations, revaluations, feeTxns, attendanceRecords, condonations, certRequests, regulation] = await Promise.all([
      this.prisma.exam_pass_rules_settings.findFirst(),
      this.prisma.grade_bands.findMany({ orderBy: { display_order: 'asc' } }),
      this.prisma.exam_marks.findMany({
        where: { student_id: studentId },
        include: {
          exam_subject_mapping: {
            include: {
              exams: { select: { id: true, academic_year: true, semester: true, exam_category: true, status: true, exam_types: { select: { name: true, category: true } } } },
              subjects: { select: { id: true, name: true, subject_code: true, credits: true } },
            },
          },
        },
        orderBy: { entered_at: 'asc' },
      }),
      this.prisma.exam_registrations.findMany({
        where: { student_id: studentId },
        include: { exams: { select: { id: true, academic_year: true, semester: true, exam_category: true, fee_amount: true } } },
        orderBy: { id: 'desc' },
      }),
      this.prisma.revaluation_requests.findMany({
        where: { student_id: studentId },
        include: { exam_marks: { include: { exam_subject_mapping: { include: { subjects: { select: { subject_code: true } } } } } } },
        orderBy: { id: 'desc' },
      }),
      this.prisma.exam_fee_transactions.findMany({ where: { student_id: studentId }, orderBy: { id: 'desc' } }),
      this.prisma.attendance_records.findMany({ where: { student_id: studentId, is_published: true }, select: { subject_id: true, status: true } }),
      this.prisma.condonation_requests.findMany({ where: { student_id: studentId } }),
      this.prisma.certificate_requests.findMany({ where: { student_id: studentId }, include: { certificate_types: { select: { name: true } } }, orderBy: { id: 'desc' } }),
      student.classes?.batches?.start_year
        ? this.prisma.regulations.findFirst({ where: { intake_start_year: student.classes.batches.start_year } })
        : Promise.resolve(null),
    ]);

    const passMark = rules ? Number(rules.pass_mark_total) : 50;
    const gradeBandsDesc = [...gradeBands].sort((a, b) => Number(b.min_percentage) - Number(a.min_percentage));

    // Combine each external exam_marks row with its real internal counterpart (same subject/class/year/sem), same join used by marks-roster/course-results.
    const combined: {
      mark: (typeof marks)[number];
      total: number | null;
      gradePoint: number | null;
      isPass: boolean | null;
    }[] = [];
    for (const m of marks) {
      const mapping = m.exam_subject_mapping;
      let total: number | null = m.marks_obtained != null ? Number(m.marks_obtained) : null;
      if (!m.is_absent && mapping.exams.exam_types.category !== 'internal') {
        const internalMapping = await this.findInternalMapping(mapping.class_id, mapping.subject_id, mapping.exams.academic_year, mapping.exams.semester, mapping.id);
        if (internalMapping) {
          const internalMark = await this.prisma.exam_marks.findUnique({
            where: { exam_subject_mapping_id_student_id: { exam_subject_mapping_id: internalMapping.id, student_id: studentId } },
          });
          if (internalMark?.marks_obtained != null && total != null) total += Number(internalMark.marks_obtained);
        }
      }
      const pct = total != null ? (total / 100) * 100 : null; // total is already the combined 0-100 scale
      const band = pct != null ? gradeBandsDesc.find((b) => pct >= Number(b.min_percentage)) : null;
      combined.push({
        mark: m,
        total: m.is_absent ? null : total,
        gradePoint: band?.grade_point != null ? Number(band.grade_point) : null,
        isPass: m.is_absent ? false : total != null ? total >= passMark : null,
      });
    }

    // Only count each (subject, exam_category=external-ish "official") row once for credits/CGPA — use the exams whose type is NOT internal, since internal rows already folded in above.
    const officialRows = combined.filter((c) => c.mark.exam_subject_mapping.exams.exam_types.category !== 'internal');

    let creditWeightedSum = 0;
    let creditsAttempted = 0;
    let creditsEarned = 0;
    const latestBySubject = new Map<number, (typeof officialRows)[number]>();
    for (const row of officialRows) {
      const subjectId = row.mark.exam_subject_mapping.subject_id;
      const existing = latestBySubject.get(subjectId);
      if (!existing || row.mark.entered_at > existing.mark.entered_at) latestBySubject.set(subjectId, row);
    }
    for (const row of latestBySubject.values()) {
      const credits = row.mark.exam_subject_mapping.subjects.credits ?? 0;
      creditsAttempted += credits;
      if (row.isPass) creditsEarned += credits;
      if (row.gradePoint != null) creditWeightedSum += row.gradePoint * credits;
    }
    const cgpa = creditsAttempted > 0 ? Math.round((creditWeightedSum / creditsAttempted) * 100) / 100 : null;

    // Standing arrears: subjects whose latest official attempt is a fail.
    const standingArrears = [...latestBySubject.values()]
      .filter((row) => row.isPass === false)
      .map((row) => {
        const subjectId = row.mark.exam_subject_mapping.subject_id;
        const attempts = officialRows.filter((r) => r.mark.exam_subject_mapping.subject_id === subjectId).length;
        const firstFail = officialRows
          .filter((r) => r.mark.exam_subject_mapping.subject_id === subjectId)
          .sort((a, b) => a.mark.entered_at.getTime() - b.mark.entered_at.getTime())[0];
        return {
          subject_code: row.mark.exam_subject_mapping.subjects.subject_code,
          subject_name: row.mark.exam_subject_mapping.subjects.name,
          standing_since: firstFail?.mark.entered_at.toISOString().slice(0, 10) ?? null,
          attempts,
        };
      });

    // Current registration: the most recent exam this student is registered/approved for.
    const currentRegistration = registrations.find((r) => r.status === 'approved') ?? registrations[0] ?? null;
    const attendanceBySubject = new Map<number, { total: number; attended: number }>();
    for (const r of attendanceRecords) {
      if (r.subject_id == null) continue;
      const e = attendanceBySubject.get(r.subject_id) ?? { total: 0, attended: 0 };
      e.total += 1;
      if (r.status !== 'absent') e.attended += 1;
      attendanceBySubject.set(r.subject_id, e);
    }
    const condonationByExam = new Map(condonations.map((c) => [c.exam_id, c]));
    const threshold = regulation ? Number(regulation.attendance_threshold_pct) : ATTENDANCE_THRESHOLD_PCT;

    let currentCourses: {
      subject_code: string;
      subject_name: string;
      attendance_pct: number | null;
      internal_marks: number | null;
      internal_max: number | null;
      eligibility: 'eligible' | 'condonation' | 'detained';
    }[] = [];
    if (currentRegistration) {
      // Resolve the student's real class for this exam's academic year/semester directly.
      const classForExam = await this.prisma.classes.findFirst({
        where: { department_id: student.classes?.department_id, current_semester: currentRegistration.exams.semester },
      });
      const realMappings = classForExam
        ? await this.prisma.exam_subject_mapping.findMany({
            where: { exam_id: currentRegistration.exam_id, class_id: classForExam.id },
            include: { subjects: { select: { subject_code: true, name: true, id: true } } },
          })
        : [];
      currentCourses = await Promise.all(
        realMappings.map(async (m) => {
          const att = attendanceBySubject.get(m.subjects.id);
          const attPct = att && att.total > 0 ? Math.round((att.attended / att.total) * 1000) / 10 : null;
          const condonation = condonationByExam.get(currentRegistration.exam_id);
          let eligibility: 'eligible' | 'condonation' | 'detained' = 'eligible';
          if (attPct != null && attPct < threshold) {
            eligibility = condonation?.status === 'approved' ? 'eligible' : condonation?.status === 'requested' ? 'condonation' : 'detained';
          }
          // The design's "Internal" column is the real CIA component, not this
          // mapping's own marks (which, for a University exam, are external).
          const internalMapping = await this.findInternalMapping(m.class_id, m.subject_id, currentRegistration.exams.academic_year, currentRegistration.exams.semester, m.id);
          const internalMark = internalMapping
            ? await this.prisma.exam_marks.findUnique({ where: { exam_subject_mapping_id_student_id: { exam_subject_mapping_id: internalMapping.id, student_id: studentId } } })
            : null;
          return {
            subject_code: m.subjects.subject_code,
            subject_name: m.subjects.name,
            attendance_pct: attPct,
            internal_marks: internalMark?.marks_obtained != null ? Number(internalMark.marks_obtained) : null,
            internal_max: internalMark ? Number(internalMark.max_marks) : null,
            eligibility,
          };
        }),
      );
    }

    // Semester history: real average grade point per semester across official rows.
    const bySemester = new Map<number, { sum: number; credits: number }>();
    for (const row of officialRows) {
      if (row.gradePoint == null) continue;
      const sem = row.mark.exam_subject_mapping.exams.semester;
      const credits = row.mark.exam_subject_mapping.subjects.credits ?? 1;
      const e = bySemester.get(sem) ?? { sum: 0, credits: 0 };
      e.sum += row.gradePoint * credits;
      e.credits += credits;
      bySemester.set(sem, e);
    }
    const semesterHistory = [...bySemester.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([semester, v]) => ({ semester, gpa: v.credits > 0 ? Math.round((v.sum / v.credits) * 100) / 100 : null }));

    const feesAndDues: { label: string; amount: number; status: 'paid' | 'unpaid' }[] = [];
    for (const t of feeTxns) feesAndDues.push({ label: `${t.fee_head.replace(/_/g, ' ')} · ${t.created_at.toISOString().slice(0, 10)}`, amount: Number(t.amount), status: t.status === 'paid' ? 'paid' : 'unpaid' });
    for (const r of registrations) {
      if (r.fee_status === 'unpaid' && r.exams.fee_amount) feesAndDues.push({ label: `${r.exams.exam_category} fee · Sem ${r.exams.semester}`, amount: Number(r.exams.fee_amount), status: 'unpaid' });
    }
    for (const rv of revaluations) {
      if (rv.fee_amount) feesAndDues.push({ label: `Revaluation · ${rv.exam_marks.exam_subject_mapping.subjects.subject_code}`, amount: Number(rv.fee_amount), status: rv.fee_paid ? 'paid' : 'unpaid' });
    }

    const totalAttendance = attendanceRecords.length;
    const attendedTotal = attendanceRecords.filter((r) => r.status !== 'absent').length;
    const overallAttendancePct = totalAttendance > 0 ? Math.round(((attendedTotal / totalAttendance) * 100 + Number.EPSILON) * 10) / 10 : null;

    return {
      student: {
        id: student.id,
        register_no: student.register_no ?? student.student_id_no,
        name: studentDisplayName(student),
        department: student.classes?.departments ?? null,
        programme: student.classes?.courses?.name ?? null,
        year: student.classes?.current_semester ? Math.ceil(student.classes.current_semester / 2) : null,
        semester: student.classes?.current_semester ?? null,
        section: student.classes?.section ?? null,
        regulation_code: regulation?.code ?? null,
        status: student.status,
      },
      stats: {
        cgpa,
        credits_earned: creditsEarned,
        credits_total: creditsAttempted,
        arrears_count: standingArrears.length,
        attendance_pct: overallAttendancePct,
        attendance_hold: overallAttendancePct != null && overallAttendancePct < threshold,
      },
      currentRegistration: currentRegistration
        ? { exam_label: `${currentRegistration.exams.exam_category} · ${currentRegistration.exams.academic_year} · Sem ${currentRegistration.exams.semester}`, courses: currentCourses }
        : null,
      standingArrears,
      feesAndDues,
      certificates: certRequests.map((c) => ({
        id: c.id,
        type_name: c.certificate_types.name,
        requested_at: c.requested_at.toISOString().slice(0, 10),
        issued_at: c.issued_at ? c.issued_at.toISOString().slice(0, 10) : null,
        status: c.status,
      })),
      semesterHistory,
    };
  }
}
