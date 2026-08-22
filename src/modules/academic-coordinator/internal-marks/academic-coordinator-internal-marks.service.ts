import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class AcademicCoordinatorInternalMarksService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/coordinator/internal-marks
   *
   * Read-only oversight — the coordinator never approves/rejects marks (that
   * stays with the faculty who entered them and the COE who publishes
   * results). Scoped to internal exams only (exam_types.category='internal'),
   * matching the page's "Internal Marks" scope rather than external/
   * university exams. Status is derived honestly from real counts
   * (exam_marks entered vs. active roster size) — there's no per-subject
   * lock/publish table to read instead (marks_entry_locks is department-
   * level, a coarser grain than this page needs).
   */
  async list() {
    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exams: { exam_types: { category: 'internal' } } },
      select: {
        id: true,
        class_id: true,
        subject_id: true,
        exam_id: true,
        exams: { select: { title: true, academic_year: true } },
        subjects: { select: { subject_code: true, name: true } },
        classes: {
          select: { section: true, departments: { select: { code: true } } },
        },
        _count: { select: { exam_marks: true } },
      },
      orderBy: { id: 'desc' },
    });

    const classIds = Array.from(new Set(mappings.map((m) => m.class_id)));
    const subjectIds = Array.from(new Set(mappings.map((m) => m.subject_id)));

    const [rosterCounts, mappingFaculty] = await Promise.all([
      this.prisma.students.groupBy({
        by: ['class_id'],
        where: { class_id: { in: classIds }, status: 'active' },
        _count: { _all: true },
      }),
      this.prisma.faculty_subject_class_mapping.findMany({
        where: { class_id: { in: classIds }, subject_id: { in: subjectIds } },
        select: {
          class_id: true,
          subject_id: true,
          faculty: {
            select: { first_name: true, last_name: true, prefix: true },
          },
        },
      }),
    ]);

    const rosterByClass = new Map(
      rosterCounts.map((r) => [r.class_id, r._count._all]),
    );
    const facultyByPair = new Map(
      mappingFaculty.map((m) => [
        `${m.class_id}:${m.subject_id}`,
        [m.faculty.prefix, m.faculty.first_name, m.faculty.last_name]
          .filter(Boolean)
          .join(' '),
      ]),
    );

    return mappings.map((m) => {
      const entered = m._count.exam_marks;
      const roster = rosterByClass.get(m.class_id) ?? 0;
      const status =
        entered === 0
          ? 'Not Started'
          : roster > 0 && entered >= roster
            ? 'Complete'
            : 'Partial';
      return {
        mapping_id: m.id,
        subject_code: m.subjects.subject_code,
        subject_name: m.subjects.name,
        class_label: `${m.classes.departments.code} ${m.classes.section}`,
        faculty_name:
          facultyByPair.get(`${m.class_id}:${m.subject_id}`) ?? null,
        assessment: m.exams.title,
        entered_count: entered,
        roster_count: roster,
        status,
      };
    });
  }
}
