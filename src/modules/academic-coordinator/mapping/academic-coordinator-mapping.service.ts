import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const MAX_SEMESTER = 8;

export interface MappedSubjectRow {
  id: number;
  subject_code: string;
  short_code: string | null;
  name: string;
  course_type: string | null;
  category: string | null;
  credits: number | null;
  department_id: number | null;
  mapped_classes: number;
}

export interface SemesterBucket {
  semester: number;
  total_classes: number;
  mapped: MappedSubjectRow[];
}

/**
 * "Map" applies a subject to a department+semester across every batch — the
 * same scoping the Academic Audit module already uses (classes filtered by
 * department_id + current_semester, no batch_id). One class_subjects row is
 * created per matching class so every section/batch currently sitting in
 * that semester picks up the mapping uniformly.
 *
 * The subject pool is deliberately NOT scoped to the target department —
 * subjects created under one department (e.g. an AD open elective) are a
 * real, expected input when mapping another department's semester (e.g.
 * CSE sem 5). Cross-department mapping only touches class_subjects, which
 * has no department column at all — nothing in the schema restricts it.
 */
@Injectable()
export class AcademicCoordinatorMappingService {
  constructor(private readonly prisma: PrismaService) {}

  async getMapping(departmentId: number) {
    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId },
      select: { id: true, current_semester: true },
    });

    const classIdsBySemester = new Map<number, number[]>();
    for (const c of classes) {
      if (c.current_semester == null) continue;
      if (!classIdsBySemester.has(c.current_semester))
        classIdsBySemester.set(c.current_semester, []);
      classIdsBySemester.get(c.current_semester)!.push(c.id);
    }

    const relevantClassIds = [...classIdsBySemester.values()].flat();
    const mappings = relevantClassIds.length
      ? await this.prisma.class_subjects.findMany({
          where: { class_id: { in: relevantClassIds } },
          select: { class_id: true, subject_id: true, semester: true },
        })
      : [];

    const countsBySemester = new Map<number, Map<number, number>>();
    for (const m of mappings) {
      const classIdsAtSemester = classIdsBySemester.get(m.semester);
      if (!classIdsAtSemester?.includes(m.class_id)) continue;
      if (!countsBySemester.has(m.semester))
        countsBySemester.set(m.semester, new Map());
      const bySubject = countsBySemester.get(m.semester)!;
      bySubject.set(m.subject_id, (bySubject.get(m.subject_id) ?? 0) + 1);
    }

    const allSubjects = await this.prisma.subjects.findMany({
      select: {
        id: true,
        subject_code: true,
        short_code: true,
        name: true,
        course_type: true,
        category: true,
        credits: true,
        department_id: true,
      },
      orderBy: { subject_code: 'asc' },
    });
    const subjectById = new Map(allSubjects.map((s) => [s.id, s]));

    const semesters: SemesterBucket[] = [];
    for (let sem = 1; sem <= MAX_SEMESTER; sem++) {
      const classIds = classIdsBySemester.get(sem) ?? [];
      const counts = countsBySemester.get(sem) ?? new Map<number, number>();
      const mapped = [...counts.entries()]
        .map(([subjectId, mappedClasses]) => {
          const s = subjectById.get(subjectId);
          if (!s) return null;
          return {
            id: s.id,
            subject_code: s.subject_code,
            short_code: s.short_code,
            name: s.name,
            course_type: s.course_type,
            category: s.category,
            credits: s.credits,
            department_id: s.department_id,
            mapped_classes: mappedClasses,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => a.subject_code.localeCompare(b.subject_code));
      semesters.push({ semester: sem, total_classes: classIds.length, mapped });
    }

    return {
      department_id: departmentId,
      semesters,
      pool: allSubjects.map((s) => ({
        id: s.id,
        subject_code: s.subject_code,
        short_code: s.short_code,
        name: s.name,
        course_type: s.course_type,
        category: s.category,
        credits: s.credits,
        department_id: s.department_id,
      })),
    };
  }

  private async classIdsFor(
    departmentId: number,
    semester: number,
  ): Promise<number[]> {
    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId, current_semester: semester },
      select: { id: true },
    });
    return classes.map((c) => c.id);
  }

  async addMapping(departmentId: number, semester: number, subjectId: number) {
    const classIds = await this.classIdsFor(departmentId, semester);
    if (classIds.length === 0)
      return { added: 0, already_mapped: 0, total_classes: 0 };

    const existing = await this.prisma.class_subjects.findMany({
      where: { class_id: { in: classIds }, subject_id: subjectId, semester },
      select: { class_id: true },
    });
    const existingIds = new Set(existing.map((e) => e.class_id));
    const toCreate = classIds.filter((id) => !existingIds.has(id));

    if (toCreate.length > 0) {
      await this.prisma.class_subjects.createMany({
        data: toCreate.map((classId) => ({
          class_id: classId,
          subject_id: subjectId,
          semester,
        })),
      });
    }

    return {
      added: toCreate.length,
      already_mapped: existingIds.size,
      total_classes: classIds.length,
    };
  }

  async removeMapping(
    departmentId: number,
    semester: number,
    subjectId: number,
  ) {
    const classIds = await this.classIdsFor(departmentId, semester);
    if (classIds.length === 0) return { removed: 0 };

    const result = await this.prisma.class_subjects.deleteMany({
      where: { class_id: { in: classIds }, subject_id: subjectId, semester },
    });
    return { removed: result.count };
  }
}
