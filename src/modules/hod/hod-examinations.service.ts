import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import type { ReportTable } from 'src/common/utils/report-export.util';
import { ExamResultsGridService } from 'src/modules/academic-structure/exam-results/exam-results-grid.service';

function yearLabel(semester: number | null): string {
  if (semester == null) return '—';
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? '—';
}

/**
 * GET /hod/examinations/filters and /hod/examinations/grid —
 * department-scoped exam results grid. The grid itself (given a validated
 * classId + examTypeId) is built by the shared ExamResultsGridService,
 * also used by AdvisorExaminationsService for the class_mentors-scoped
 * variant — this service owns only the department-based authorization and
 * the filter catalog (which classes/exam types a HoD sees at all).
 */
@Injectable()
export class HodExaminationsService {
  private readonly logger = new Logger(HodExaminationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly examResultsGrid: ExamResultsGridService,
  ) {}

  private async resolveDepartmentId(user: JwtPayload): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.department_id;
  }

  async getFilters(user: JwtPayload) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
        select: { id: true, name: true, code: true },
      });
      if (!department) {
        throw new NotFoundException({
          message: 'Department not found.',
          errorCode: 'DEPARTMENT_NOT_FOUND',
        });
      }

      const classes = await this.prisma.classes.findMany({
        where: { department_id: departmentId },
        select: {
          id: true,
          batch_id: true,
          current_semester: true,
          section: true,
        },
        orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
      });
      const batchIds = [...new Set(classes.map((c) => c.batch_id))];
      const batches = batchIds.length
        ? await this.prisma.batches.findMany({
            where: { id: { in: batchIds } },
            select: { id: true, name: true },
          })
        : [];

      // Only exam types actually used by exams that touch this department's
      // classes — not the full institution-wide catalog.
      const usedExamTypeIds = await this.prisma.$queryRaw<
        { exam_type_id: number }[]
      >`
        SELECT DISTINCT e.exam_type_id
        FROM exams e
        JOIN exam_subject_mapping esm ON esm.exam_id = e.id
        JOIN classes cl ON cl.id = esm.class_id
        WHERE cl.department_id = ${departmentId}
      `;
      const examTypeIds = usedExamTypeIds.map((r) => r.exam_type_id);
      const examTypes = examTypeIds.length
        ? await this.prisma.exam_types.findMany({
            where: { id: { in: examTypeIds } },
            select: { id: true, name: true, category: true },
          })
        : [];

      return {
        department: {
          id: department.id,
          name: department.name,
          code: department.code,
        },
        batches: batches.map((b) => ({ id: b.id, label: b.name })),
        classes: classes.map((c) => ({
          class_id: c.id,
          batch_id: c.batch_id,
          semester: c.current_semester ?? 0,
          year_label: yearLabel(c.current_semester),
          section: c.section,
        })),
        exam_types: examTypes.map((t) => ({
          id: t.id,
          name: t.name,
          category: t.category,
        })),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD examination filters', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertOwnsClass(user: JwtPayload, classId: number): Promise<void> {
    const departmentId = await this.resolveDepartmentId(user);
    const cls = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true },
    });
    if (!cls || cls.department_id !== departmentId) {
      throw new NotFoundException({
        message: 'Class not found in your department.',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }
  }

  async getGrid(user: JwtPayload, classId: number, examTypeId: number) {
    await this.assertOwnsClass(user, classId);
    return this.examResultsGrid.buildGrid(classId, examTypeId);
  }

  /**
   * GET /hod/examinations/grid/export — same data as getGrid(), reshaped
   * into the shared ReportTable the export utility expects. One column per
   * paper (subject code) plus Average — matches the on-screen grid exactly
   * so the download is never out of sync with what the HoD is looking at.
   */
  async getGridExportTable(
    user: JwtPayload,
    classId: number,
    examTypeId: number,
  ): Promise<ReportTable> {
    await this.assertOwnsClass(user, classId);
    return this.examResultsGrid.buildGridExportTable(classId, examTypeId);
  }
}
