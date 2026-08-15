import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetAcademicClearanceDto } from './dto/get-academic-clearance.dto';

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * No configured minimum attendance percentage exists anywhere in this
 * schema for academic-clearance purposes (checked hostel_settings,
 * grade_bands, courses, departments — nothing fits; hostel_settings'
 * min_attendance_for_auto_pct is scoped to hostel-outing auto-approval,
 * unrelated). This is a placeholder for wherever the real institutional
 * policy value should eventually come from — change it here if that
 * value gets a real home in the schema.
 */
const MIN_ATTENDANCE_PERCENT = 75;

@Injectable()
export class MeAcademicClearanceService {
  private readonly logger = new Logger(MeAcademicClearanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/academic-clearance?semester=<n>
   *
   * Self-scoped: class_id/batch_id resolved from the JWT's linked student
   * record. For the given (or current) semester: every subject the class
   * has that semester (class_subjects — same source-of-truth convention as
   * LmsService.getMySubjects), each with its real assignments and this
   * student's own submission status (assignments + student_assignment_status,
   * same pattern as LmsService.getStudentTasks but across every subject at
   * once instead of one at a time), plus attendance aggregated over that
   * semester's date range (via academic_calendars, keyed by batch+semester —
   * arbitrary semesters are directly lookupable, not just "current").
   *
   * A semester with no academic_calendars row yet returns
   * attendance_percentage: null rather than a fabricated number.
   */
  async getMyAcademicClearance(userId: number, dto: GetAcademicClearanceDto) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true, class_id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    if (!student.class_id) {
      return { semester: dto.semester ?? null, subjects: [] };
    }

    const klass = await this.prisma.classes.findUnique({
      where: { id: student.class_id },
      select: { batch_id: true, current_semester: true },
    });
    const semester = dto.semester ?? klass?.current_semester ?? null;
    if (!klass || semester === null) {
      return { semester: null, subjects: [] };
    }

    const classSubjectRows = await this.prisma.class_subjects.findMany({
      where: { class_id: student.class_id, semester },
      select: {
        subject_id: true,
        subjects: { select: { id: true, name: true, subject_code: true } },
      },
      orderBy: { subjects: { name: 'asc' } },
    });
    if (classSubjectRows.length === 0) {
      return { semester, subjects: [] };
    }
    const subjectIds = classSubjectRows.map((r) => r.subject_id);

    const assignmentRows = await this.prisma.assignments.findMany({
      where: {
        class_id: student.class_id,
        subject_id: { in: subjectIds },
        semester,
      },
      select: {
        id: true,
        title: true,
        sequence_no: true,
        subject_id: true,
        student_assignment_status: {
          where: { student_id: student.id },
          select: { is_submitted: true },
        },
      },
      orderBy: { sequence_no: 'asc' },
    });
    const assignmentsBySubject = new Map<number, typeof assignmentRows>();
    for (const a of assignmentRows) {
      const list = assignmentsBySubject.get(a.subject_id) ?? [];
      list.push(a);
      assignmentsBySubject.set(a.subject_id, list);
    }

    const attendanceBySubject = await this.computeAttendanceBySubject(
      student.id,
      klass.batch_id,
      semester,
      subjectIds,
    );

    return {
      semester,
      subjects: classSubjectRows.map((row) => {
        const assignments = (
          assignmentsBySubject.get(row.subject_id) ?? []
        ).map((a) => ({
          id: a.id,
          title: a.title,
          sequence_no: a.sequence_no,
          is_submitted: a.student_assignment_status[0]?.is_submitted ?? false,
        }));
        const allAssignmentsSubmitted = assignments.every(
          (a) => a.is_submitted,
        );
        const attendancePercentage =
          attendanceBySubject.get(row.subject_id) ?? null;
        const attendanceCleared =
          attendancePercentage !== null &&
          attendancePercentage >= MIN_ATTENDANCE_PERCENT;

        return {
          subject_id: row.subject_id,
          subject_name: row.subjects.name,
          subject_code: row.subjects.subject_code,
          assignments,
          all_assignments_submitted: allAssignmentsSubmitted,
          attendance_percentage: attendancePercentage,
          attendance_cleared: attendanceCleared,
          cleared: allAssignmentsSubmitted && attendanceCleared,
        };
      }),
    };
  }

  /**
   * Mirrors MeAttendanceService's by_subject computation
   * (me-attendance.service.ts) — 'on_duty' is not counted toward `present`,
   * matching that same existing convention exactly, just scoped to one
   * semester's date range (via academic_calendars) instead of a caller-
   * supplied from/to range.
   */
  private async computeAttendanceBySubject(
    studentId: number,
    batchId: number,
    semester: number,
    subjectIds: number[],
  ) {
    const result = new Map<number, number>();

    const calendar = await this.prisma.academic_calendars.findUnique({
      where: { batch_id_semester: { batch_id: batchId, semester } },
      select: { start_date: true, end_date: true },
    });
    if (!calendar) return result;

    const records = await this.prisma.attendance_records.findMany({
      where: {
        student_id: studentId,
        subject_id: { in: subjectIds },
        attendance_date: { gte: calendar.start_date, lte: calendar.end_date },
      },
      select: { subject_id: true, status: true },
    });

    const totals = new Map<number, { total: number; present: number }>();
    for (const r of records) {
      if (r.subject_id === null) continue;
      const entry = totals.get(r.subject_id) ?? { total: 0, present: 0 };
      entry.total += 1;
      if (r.status === 'present') entry.present += 1;
      totals.set(r.subject_id, entry);
    }
    for (const [subjectId, entry] of totals) {
      result.set(subjectId, round2((entry.present / entry.total) * 100));
    }
    return result;
  }
}
