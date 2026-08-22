import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AcademicCoordinatorCourseProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/coordinator/course-progress
   *
   * No existing endpoint lists lesson plans institution-wide — every LMS
   * route is scoped to the caller's own subjects (student) or own classes
   * (faculty/HoD). Session-level completion (`is_covered`) genuinely has
   * only 1 real row across the whole database today (verified live) — this
   * returns that honestly (most plans show 0/0 sessions) rather than
   * fabricating a fixed unit count the way the reference mockup does.
   */
  async list() {
    const plans = await this.prisma.lesson_plans.findMany({
      select: {
        id: true,
        semester: true,
        faculty: {
          select: { first_name: true, last_name: true, prefix: true },
        },
        subjects: { select: { subject_code: true, name: true } },
        classes: {
          select: {
            id: true,
            batch_id: true,
            department_id: true,
            section: true,
            departments: { select: { code: true } },
          },
        },
        lesson_plan_sessions: {
          select: {
            id: true,
            sequence_no: true,
            unit_title: true,
            topic: true,
            is_covered: true,
            session_date: true,
          },
          orderBy: { sequence_no: 'asc' },
        },
      },
      orderBy: { id: 'desc' },
    });

    return plans.map((p) => {
      const total = p.lesson_plan_sessions.length;
      const covered = p.lesson_plan_sessions.filter((s) => s.is_covered).length;
      return {
        id: p.id,
        subject_code: p.subjects.subject_code,
        subject_name: p.subjects.name,
        class_id: p.classes.id,
        batch_id: p.classes.batch_id,
        department_id: p.classes.department_id,
        class_label: `${p.classes.departments.code} ${p.classes.section}`,
        faculty_name: [
          p.faculty.prefix,
          p.faculty.first_name,
          p.faculty.last_name,
        ]
          .filter(Boolean)
          .join(' '),
        semester: p.semester,
        sessions: p.lesson_plan_sessions.map((s) => ({
          id: s.id,
          sequence_no: s.sequence_no,
          unit_title: s.unit_title,
          topic: s.topic,
          is_covered: s.is_covered,
          session_date: s.session_date,
        })),
        total_sessions: total,
        covered_sessions: covered,
        percent_complete:
          total > 0 ? Math.round((covered / total) * 100) : null,
      };
    });
  }
}
