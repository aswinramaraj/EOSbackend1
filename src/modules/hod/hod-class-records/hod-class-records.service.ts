import {
  Injectable,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { computeGpa, isPassingPercentage } from '../shared/grade-scale.util';

const ATTENDANCE_THRESHOLD_PERCENT = 75;
/** Matches the design reference's own rule exactly (HOD Portal.dc.html:3777): "Top performer" only applies as a fallback when a student has no other flag AND CGPA >= 8.5. */
const TOP_PERFORMER_CGPA = 8.5;

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
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

function toPercentage(marksObtained: unknown, maxMarks: unknown): number {
  const scored = Number(marksObtained);
  const max = Number(maxMarks);
  return max > 0 ? (scored / max) * 100 : 0;
}

@Injectable()
export class HodClassRecordsService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /** GET /hod/class-records/classes — every class in the caller's department, for the year/section tabs. */
  async getClasses(userId: number) {
    const { department_id } = await this.resolveHodDepartment(userId);
    const classes = await this.prisma.classes.findMany({
      where: { department_id, current_semester: { not: null } },
      select: {
        id: true,
        section: true,
        current_semester: true,
        _count: { select: { students: true } },
      },
      orderBy: [{ current_semester: 'desc' }, { section: 'asc' }],
    });
    return classes.map((c) => ({
      class_id: c.id,
      section: c.section,
      year: yearLabelForSemester(c.current_semester as number),
      semester: c.current_semester,
      student_count: c._count.students,
    }));
  }

  /** GET /hod/class-records/:classId — full roster + class-level stats. Verifies the class belongs to the caller's own department before returning anything. */
  async getClassDetail(userId: number, classId: number) {
    const { department_id } = await this.resolveHodDepartment(userId);

    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: {
        id: true,
        section: true,
        current_semester: true,
        department_id: true,
        classroom: true,
        departments: { select: { name: true, code: true } },
        courses: { select: { duration_years: true } },
      },
    });
    if (!klass) throw new NotFoundException('Class not found');
    if (klass.department_id !== department_id) {
      throw new ForbiddenException('This class is not in your department');
    }
    const semester = klass.current_semester;
    if (semester == null) {
      return {
        class: this.classSummary(klass, 0),
        advisor: null,
        stats: null,
        students: [],
      };
    }

    const [mentor, students] = await Promise.all([
      this.prisma.class_mentors.findFirst({
        where: { class_id: classId },
        orderBy: { academic_year: 'desc' },
        select: {
          faculty: {
            select: {
              prefix: true,
              first_name: true,
              last_name: true,
              designation: true,
              users: { select: { email: true, phone: true } },
            },
          },
        },
      }),
      this.prisma.students.findMany({
        where: { class_id: classId, status: 'active' },
        select: {
          id: true,
          student_id_no: true,
          photo_url: true,
          soa_applications: { select: { first_name: true, last_name: true } },
          users: { select: { email: true } },
        },
        orderBy: { student_id_no: 'asc' },
      }),
    ]);

    const studentIds = students.map((s) => s.id);
    const [allMarks, attendanceRows, feeMappings, placedIds] =
      await Promise.all([
        this.getAllExternalMarks(studentIds),
        this.getAttendanceTotals(studentIds),
        this.getFeeMappings(studentIds),
        this.getPlacedStudentIds(studentIds),
      ]);

    const isFinalYear =
      klass.courses != null && semester >= klass.courses.duration_years * 2 - 1;

    const roster = students.map((s) => {
      const marks = allMarks.get(s.id) ?? [];
      const currentSemesterMarks = marks.filter((m) => m.semester === semester);
      const gpa = computeGpa(
        currentSemesterMarks
          .filter((m) => !m.is_absent && m.marks_obtained != null)
          .map((m) => ({ percentage: m.percentage, credits: m.credits })),
      );
      const cgpa = computeGpa(
        marks
          .filter((m) => !m.is_absent && m.marks_obtained != null)
          .map((m) => ({ percentage: m.percentage, credits: m.credits })),
      );
      const arrears = currentSemesterMarks.filter(
        (m) => m.is_absent || !isPassingPercentage(m.percentage),
      ).length;

      const attendance = attendanceRows.get(s.id) ?? { present: 0, total: 0 };
      const attendancePercent =
        attendance.total > 0
          ? Math.round((attendance.present / attendance.total) * 1000) / 10
          : null;

      const fee = feeMappings.get(s.id);
      const feeStatus = fee
        ? { status: fee.status, due: fee.due }
        : { status: 'paid' as DueStatus, due: 0 };

      const isLowAttendance =
        attendancePercent != null &&
        attendancePercent < ATTENDANCE_THRESHOLD_PERCENT;
      const isFeesDue = feeStatus.status !== 'paid';

      // Exact priority order + "top performer as fallback only" rule and the
      // 2-flag display cap, matched precisely from the design reference
      // (HOD Portal.dc.html:3773-3778) rather than approximated.
      const allFlags: {
        label: string;
        tone: 'red' | 'amber' | 'green' | 'grey';
      }[] = [];
      if (isLowAttendance)
        allFlags.push({ label: 'Low attendance', tone: 'red' });
      if (arrears > 0) {
        allFlags.push({
          label: `${arrears} arrear${arrears === 1 ? '' : 's'}`,
          tone: 'amber',
        });
      }
      if (isFeesDue) allFlags.push({ label: 'Fees due', tone: 'red' });
      if (allFlags.length === 0 && cgpa != null && cgpa >= TOP_PERFORMER_CGPA) {
        allFlags.push({ label: 'Top performer', tone: 'green' });
      }
      if (allFlags.length === 0)
        allFlags.push({ label: 'All clear', tone: 'grey' });
      const flags = allFlags.slice(0, 2);
      const atRisk = isLowAttendance || isFeesDue;

      return {
        student_id: s.id,
        student_id_no: s.student_id_no,
        // students has no name columns of its own — soa_applications is the
        // only source, and isn't populated for every student (e.g. never
        // completed the online admission form). Falls back to email rather
        // than an empty bold name line, matching the same fallback used
        // elsewhere for this exact gap (assignments.service.ts and others).
        name: s.soa_applications
          ? [s.soa_applications.first_name, s.soa_applications.last_name]
              .filter(Boolean)
              .join(' ')
          : s.users.email,
        photo_url: s.photo_url,
        class_label: `${yearLabelForSemester(semester)}-${klass.section}`,
        gpa,
        cgpa,
        arrears,
        attendance_percent: attendancePercent,
        fee_status: feeStatus.status,
        fee_due: feeStatus.due,
        is_placed: placedIds.has(s.id),
        at_risk: atRisk,
        flags,
      };
    });

    const attendanceValues = roster
      .map((r) => r.attendance_percent)
      .filter((v): v is number => v != null);
    const cgpaValues = roster
      .map((r) => r.cgpa)
      .filter((v): v is number => v != null);
    const feesPendingCount = roster.filter(
      (r) => r.fee_status !== 'paid',
    ).length;
    const eligibleCount = isFinalYear ? roster.length : 0;
    const placedCount = isFinalYear
      ? roster.filter((r) => r.is_placed).length
      : 0;

    return {
      class: this.classSummary(klass, roster.length),
      advisor: mentor
        ? {
            name: [
              mentor.faculty.prefix,
              mentor.faculty.first_name,
              mentor.faculty.last_name,
            ]
              .filter(Boolean)
              .join(' '),
            designation: mentor.faculty.designation,
            department_code: klass.departments?.code ?? '',
            phone: mentor.faculty.users?.phone ?? null,
            email: mentor.faculty.users?.email ?? null,
          }
        : null,
      stats: {
        mean_attendance: average(attendanceValues),
        average_cgpa: average(cgpaValues),
        placed_count: placedCount,
        eligible_count: eligibleCount,
        fees_pending_count: feesPendingCount,
        student_count: roster.length,
      },
      students: roster,
    };
  }

  private classSummary(
    klass: {
      id: number;
      section: string;
      current_semester: number | null;
      classroom: string | null;
      departments: { name: string; code: string } | null;
    },
    studentCount: number,
  ) {
    return {
      class_id: klass.id,
      section: klass.section,
      semester: klass.current_semester,
      year: klass.current_semester
        ? yearLabelForSemester(klass.current_semester)
        : null,
      department_name: klass.departments?.name ?? '',
      department_code: klass.departments?.code ?? '',
      classroom: klass.classroom,
      student_count: studentCount,
    };
  }

  private async getAllExternalMarks(studentIds: number[]) {
    if (studentIds.length === 0) return new Map<number, never[]>();
    const rows = await this.prisma.exam_marks.findMany({
      where: {
        student_id: { in: studentIds },
        exam_subject_mapping: {
          exams: { exam_types: { category: 'external' } },
        },
      },
      select: {
        student_id: true,
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
    const byStudent = new Map<
      number,
      {
        marks_obtained: unknown;
        is_absent: boolean;
        percentage: number;
        credits: number | null;
        semester: number;
      }[]
    >();
    for (const row of rows) {
      const list = byStudent.get(row.student_id) ?? [];
      list.push({
        marks_obtained: row.marks_obtained,
        is_absent: row.is_absent,
        percentage: toPercentage(row.marks_obtained, row.max_marks),
        credits: row.exam_subject_mapping.subjects.credits,
        semester: row.exam_subject_mapping.exams.semester,
      });
      byStudent.set(row.student_id, list);
    }
    return byStudent;
  }

  private async getAttendanceTotals(studentIds: number[]) {
    const totals = new Map<number, { present: number; total: number }>();
    if (studentIds.length === 0) return totals;
    const rows = await this.prisma.attendance_records.groupBy({
      by: ['student_id', 'status'],
      where: { student_id: { in: studentIds } },
      _count: { _all: true },
    });
    for (const row of rows) {
      const entry = totals.get(row.student_id) ?? { present: 0, total: 0 };
      entry.total += row._count._all;
      if (row.status === 'present') entry.present += row._count._all;
      totals.set(row.student_id, entry);
    }
    return totals;
  }

  /** Mirrors FinanceOverviewService's own live-recomputed total/paid/outstanding pattern (never trusts the total_amount snapshot column) — scoped to one roster instead of the whole institution. */
  private async getFeeMappings(studentIds: number[]) {
    const result = new Map<number, { status: DueStatus; due: number }>();
    if (studentIds.length === 0) return result;
    const mappings = await this.prisma.student_fee_demand_mapping.findMany({
      where: { student_id: { in: studentIds } },
      select: {
        student_id: true,
        fee_payments: { select: { amount_paid: true } },
        fee_structures: {
          select: { fee_structure_items: { select: { amount: true } } },
        },
      },
    });
    const byStudent = new Map<number, typeof mappings>();
    for (const m of mappings) {
      const list = byStudent.get(m.student_id) ?? [];
      list.push(m);
      byStudent.set(m.student_id, list);
    }
    for (const [studentId, studentMappings] of byStudent) {
      let totalDue = new Prisma.Decimal(0);
      let anyPending = false;
      let anyPartial = false;
      for (const m of studentMappings) {
        const total = m.fee_structures.fee_structure_items.reduce(
          (sum, item) => sum.plus(item.amount),
          new Prisma.Decimal(0),
        );
        const paid = m.fee_payments.reduce(
          (sum, p) => sum.plus(p.amount_paid),
          new Prisma.Decimal(0),
        );
        const outstanding = clampNonNegative(total.minus(paid));
        totalDue = totalDue.plus(outstanding);
        const status = dueStatusOf(total, paid);
        if (status === 'pending') anyPending = true;
        if (status === 'partial') anyPartial = true;
      }
      result.set(studentId, {
        status: anyPending ? 'pending' : anyPartial ? 'partial' : 'paid',
        due: totalDue.toNumber(),
      });
    }
    return result;
  }

  private async getPlacedStudentIds(studentIds: number[]) {
    if (studentIds.length === 0) return new Set<number>();
    const rows = await this.prisma.student_drive_applications.findMany({
      where: { student_id: { in: studentIds }, status: 'placed' },
      select: { student_id: true },
      distinct: ['student_id'],
    });
    return new Set(rows.map((r) => r.student_id));
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return (
    Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 100) / 100
  );
}
