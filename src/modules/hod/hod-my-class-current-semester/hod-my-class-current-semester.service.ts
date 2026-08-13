import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/** Same academic-year convention used elsewhere in this codebase (e.g. hod-employee-timetable.service.ts). */
function academicYearFor(date: Date): string {
  const calendarYear = date.getUTCFullYear();
  const academicStartYear =
    date.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * First letter of every real word in the subject name, capped at 4 chars —
 * a presentational acronym for the card chip, not stored/real data. The
 * reference screenshot's own chips are inconsistently truncated between
 * subjects with the same word count (demo styling, not a derivable rule),
 * so this applies one consistent rule instead of guessing at the exact
 * per-subject truncation shown there.
 */
function subjectInitials(name: string): string {
  const words = name
    .split(/\s+/)
    .filter((w) => /[A-Za-z]/.test(w) && w.length > 1);
  const initials = words.map((w) => w[0].toUpperCase()).join('');
  return initials.slice(0, 4) || name.slice(0, 2).toUpperCase();
}

@Injectable()
export class HodMyClassCurrentSemesterService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveFaculty(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /**
   * GET /hod/my-class/current-semester — every (class, subject) the caller
   * personally teaches, each with real counts: LMS materials uploaded,
   * assignments/tasks created, weekly scheduled hours (summed from their own
   * timetable_slots rows for the current academic year), and lesson-plan
   * syllabus coverage (covered vs total lesson_plan_sessions for their own
   * lesson_plans row at that class's current semester).
   */
  async getOverview(userId: number) {
    const faculty = await this.resolveFaculty(userId);
    const academicYear = academicYearFor(new Date());

    const mappings = await this.prisma.faculty_subject_class_mapping.findMany({
      where: { faculty_id: faculty.id },
      select: {
        class_id: true,
        subject_id: true,
        classes: { select: { section: true, current_semester: true } },
        subjects: { select: { name: true, subject_code: true } },
      },
      orderBy: [
        { academic_year: 'desc' },
        { class_id: 'asc' },
        { subject_id: 'asc' },
      ],
    });

    const seen = new Set<string>();
    const handled = mappings.filter((m) => {
      const key = `${m.class_id}-${m.subject_id}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const subjects = await Promise.all(
      handled.map(async (m) => {
        const semester = m.classes.current_semester;

        const [materialsCount, tasksCount, slots, lessonPlan] =
          await Promise.all([
            this.prisma.lms_notes.count({
              where: {
                faculty_id: faculty.id,
                subject_id: m.subject_id,
                class_id: m.class_id,
              },
            }),
            this.prisma.assignments.count({
              where: {
                faculty_id: faculty.id,
                subject_id: m.subject_id,
                class_id: m.class_id,
              },
            }),
            this.prisma.timetable_slots.findMany({
              where: {
                faculty_id: faculty.id,
                subject_id: m.subject_id,
                class_id: m.class_id,
                academic_year: academicYear,
              },
              select: { start_time: true, end_time: true },
            }),
            semester != null
              ? this.prisma.lesson_plans.findUnique({
                  where: {
                    faculty_id_subject_id_class_id_semester: {
                      faculty_id: faculty.id,
                      subject_id: m.subject_id,
                      class_id: m.class_id,
                      semester,
                    },
                  },
                  select: {
                    lesson_plan_sessions: { select: { is_covered: true } },
                  },
                })
              : null,
          ]);

        const totalMinutes = slots.reduce(
          (sum, s) =>
            sum + (s.end_time.getTime() - s.start_time.getTime()) / 60000,
          0,
        );
        const hoursPerWeek = Math.round(totalMinutes / 60);

        const sessions = lessonPlan?.lesson_plan_sessions ?? [];
        const coveredCount = sessions.filter((s) => s.is_covered).length;
        const percentCovered =
          sessions.length > 0
            ? Math.round((coveredCount / sessions.length) * 100)
            : null;

        return {
          class_id: m.class_id,
          subject_id: m.subject_id,
          subject_name: m.subjects.name,
          subject_code: m.subjects.subject_code,
          section: m.classes.section,
          semester,
          initials: subjectInitials(m.subjects.name),
          hours_per_week: hoursPerWeek,
          materials_count: materialsCount,
          tasks_count: tasksCount,
          percent_covered: percentCovered,
        };
      }),
    );

    return { academic_year: academicYear, subjects };
  }
}
