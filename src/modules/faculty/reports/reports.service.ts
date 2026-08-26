import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const WEEKS_RETURNED = 8;

/** Monday (UTC) of the ISO week containing `date`. */
function mondayOf(date: Date): string {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  const dow = d.getUTCDay(); // 0=Sun..6=Sat
  const deltaToMonday = dow === 0 ? -6 : 1 - dow;
  d.setUTCDate(d.getUTCDate() + deltaToMonday);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class FacultyReportsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/reports/weekly-attendance (Faculty only).
   *
   * Replaces what was previously a literal dev-comment shown as UI text on
   * the Reports page ("No weekly attendance-trend endpoint exists yet —
   * this chart shows real grade distribution per exam record instead").
   * Real weekly present/total, computed from attendance_records for every
   * student in every class this faculty is mapped to teach
   * (faculty_subject_class_mapping — the same "classes you handle" set the
   * Reports page's other KPIs already use), grouped by the Monday of each
   * ISO week. Only the most recent WEEKS_RETURNED weeks that actually have
   * at least one record are returned — no invented zero-filled weeks for
   * periods before the faculty had any classes.
   */
  async getWeeklyAttendanceTrend(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }

    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: faculty.id },
      select: { class_id: true },
    });
    const classIds = [...new Set(mappings.map((m) => m.class_id))];
    if (classIds.length === 0) {
      return { weeks: [] };
    }

    const students = await this.prisma.students.findMany({
      where: { class_id: { in: classIds } },
      select: { id: true },
    });
    const studentIds = students.map((s) => s.id);
    if (studentIds.length === 0) {
      return { weeks: [] };
    }

    const records = await this.prisma.attendance_records.findMany({
      where: { student_id: { in: studentIds } },
      select: { attendance_date: true, status: true },
    });

    const byWeek = new Map<string, { present: number; total: number }>();
    for (const r of records) {
      const weekStart = mondayOf(r.attendance_date);
      const entry = byWeek.get(weekStart) ?? { present: 0, total: 0 };
      entry.total += 1;
      if (r.status === 'present') entry.present += 1;
      byWeek.set(weekStart, entry);
    }

    const weeks = [...byWeek.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-WEEKS_RETURNED)
      .map(([week_start, { present, total }]) => ({
        week_start,
        present_percent: Math.round((present / total) * 10000) / 100,
        marked_count: total,
      }));

    return { weeks };
  }
}
