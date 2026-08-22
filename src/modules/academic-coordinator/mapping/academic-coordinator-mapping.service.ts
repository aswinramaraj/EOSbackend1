import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * "Map" applies a subject to a department+semester across every batch — the
 * same scoping the Academic Audit module already uses (classes filtered by
 * department_id + current_semester, no batch_id). One class_subjects row is
 * created per matching class so every section/batch currently sitting in
 * that semester picks up the mapping uniformly.
 */
@Injectable()
export class AcademicCoordinatorMappingService {
  constructor(private readonly prisma: PrismaService) {}

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

  async getMapping(departmentId: number, semester: number) {
    const classIds = await this.classIdsFor(departmentId, semester);

    const subjects = await this.prisma.subjects.findMany({
      where: { department_id: departmentId },
      select: {
        id: true,
        subject_code: true,
        short_code: true,
        name: true,
        course_type: true,
        category: true,
        credits: true,
      },
      orderBy: { subject_code: 'asc' },
    });

    const mappedCounts = classIds.length
      ? await this.prisma.class_subjects.groupBy({
          by: ['subject_id'],
          where: { class_id: { in: classIds }, semester },
          _count: { _all: true },
        })
      : [];
    const countBySubject = new Map(
      mappedCounts.map((m) => [m.subject_id, m._count._all]),
    );

    return {
      department_id: departmentId,
      semester,
      total_classes: classIds.length,
      pool: subjects.map((s) => ({
        id: s.id,
        subject_code: s.subject_code,
        short_code: s.short_code,
        name: s.name,
        course_type: s.course_type,
        category: s.category,
        credits: s.credits,
        mapped_classes: countBySubject.get(s.id) ?? 0,
      })),
    };
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
