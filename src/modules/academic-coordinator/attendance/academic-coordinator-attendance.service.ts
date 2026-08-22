import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable()
export class AcademicCoordinatorAttendanceService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/coordinator/attendance/classes/:classId
   *
   * No existing endpoint aggregates attendance % per student across a whole
   * class — every aggregator in the codebase (me-attendance.service.ts,
   * students.service.ts getAttendanceSummary) is single-student-scoped. This
   * reuses the exact same round2(present/total*100) formula and "only
   * status==='present' counts toward the numerator" convention those use,
   * just applied across a roster instead of one student.
   */
  async classAttendance(classId: number) {
    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
    });
    if (!klass) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const [students, classSubjects, records] = await Promise.all([
      this.prisma.students.findMany({
        where: { class_id: classId, status: 'active' },
        select: {
          id: true,
          student_id_no: true,
          roll_no: true,
          soa_applications: { select: { first_name: true, last_name: true } },
        },
        orderBy: { roll_no: 'asc' },
      }),
      // class_subjects spans every semester of the course, not just the
      // class's current one — filtering to current_semester keeps the
      // column set to what's actually being taught right now (falls back to
      // every mapped subject if current_semester was never set).
      this.prisma.class_subjects.findMany({
        where: {
          class_id: classId,
          ...(klass.current_semester != null
            ? { semester: klass.current_semester }
            : {}),
        },
        select: {
          subjects: { select: { id: true, name: true, subject_code: true } },
        },
      }),
      this.prisma.attendance_records.findMany({
        where: { class_id: classId, subject_id: { not: null } },
        select: { student_id: true, subject_id: true, status: true },
      }),
    ]);

    const subjects = classSubjects.map((cs) => cs.subjects);

    const roster = students.map((s) => ({
      id: s.id,
      roll_no: s.roll_no,
      student_id_no: s.student_id_no,
      name:
        [s.soa_applications?.first_name, s.soa_applications?.last_name]
          .filter(Boolean)
          .join(' ') || s.student_id_no,
    }));

    // student_id -> subject_id -> { present, total }
    const bySubject = new Map<
      number,
      Map<number, { present: number; total: number }>
    >();
    for (const r of records) {
      if (r.subject_id == null) continue;
      const perSubject =
        bySubject.get(r.student_id) ??
        new Map<number, { present: number; total: number }>();
      const entry = perSubject.get(r.subject_id) ?? { present: 0, total: 0 };
      entry.total += 1;
      if (r.status === 'present') entry.present += 1;
      perSubject.set(r.subject_id, entry);
      bySubject.set(r.student_id, perSubject);
    }

    const rows = roster.map((student) => {
      const perSubject =
        bySubject.get(student.id) ??
        new Map<number, { present: number; total: number }>();
      let present = 0;
      let total = 0;
      const subjectPercentages: Record<number, number | null> = {};
      for (const subject of subjects) {
        const entry = perSubject.get(subject.id);
        subjectPercentages[subject.id] =
          entry && entry.total > 0
            ? round2((entry.present / entry.total) * 100)
            : null;
        if (entry) {
          present += entry.present;
          total += entry.total;
        }
      }
      const overall = total > 0 ? round2((present / total) * 100) : null;
      return {
        student,
        subject_percentages: subjectPercentages,
        overall_percentage: overall,
        status: overall != null && overall < 75 ? 'Shortage' : 'Adequate',
      };
    });

    return { class_id: classId, subjects, rows };
  }
}
