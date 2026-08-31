import {
  ForbiddenException,
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
 * GET /me/advisor-examinations/{filters,grid,grid/export} — the same
 * class × exam-type marks grid HoD's console shows (built by the shared
 * ExamResultsGridService), scoped to the caller's OWN mentee class(es)
 * instead of a whole department. Ownership is via class_mentors, the same
 * table GET /me/mentee-classes already resolves from — an advisor with no
 * mentee class just sees an empty filter catalog, never a hard 403 (same
 * "empty, not forbidden" shape ClassMentorsService.getMenteeClasses uses).
 */
@Injectable()
export class AdvisorExaminationsService {
  private readonly logger = new Logger(AdvisorExaminationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly examResultsGrid: ExamResultsGridService,
  ) {}

  private async resolveFacultyId(user: JwtPayload): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.id;
  }

  private async menteeClassIds(facultyId: number): Promise<number[]> {
    const rows = await this.prisma.class_mentors.findMany({
      where: { faculty_id: facultyId },
      select: { class_id: true },
      distinct: ['class_id'],
    });
    return rows.map((r) => r.class_id);
  }

  async getFilters(user: JwtPayload) {
    const facultyId = await this.resolveFacultyId(user);
    try {
      const classIds = await this.menteeClassIds(facultyId);
      if (classIds.length === 0) {
        return { classes: [], exam_types: [] };
      }

      const classes = await this.prisma.classes.findMany({
        where: { id: { in: classIds } },
        select: {
          id: true,
          section: true,
          current_semester: true,
          batches: { select: { id: true, name: true } },
          departments: { select: { id: true, name: true, code: true } },
        },
        orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
      });

      // Plain Prisma query rather than $queryRaw — classIds is a real
      // array here, and raw SQL's tagged-template interpolation would
      // parameterize a joined "1,2,3" string as a single value (not an
      // expanded IN list), silently matching nothing.
      const usedExamTypes = await this.prisma.exams.findMany({
        where: { exam_subject_mapping: { some: { class_id: { in: classIds } } } },
        select: { exam_type_id: true },
        distinct: ['exam_type_id'],
      });
      const examTypeIds = usedExamTypes.map((r) => r.exam_type_id);
      const examTypes = examTypeIds.length
        ? await this.prisma.exam_types.findMany({
            where: { id: { in: examTypeIds } },
            select: { id: true, name: true, category: true },
          })
        : [];

      return {
        classes: classes.map((c) => ({
          class_id: c.id,
          batch_id: c.batches?.id ?? null,
          batch_label: c.batches?.name ?? '—',
          department: c.departments ? { id: c.departments.id, name: c.departments.name, code: c.departments.code } : null,
          semester: c.current_semester ?? 0,
          year_label: yearLabel(c.current_semester),
          section: c.section,
        })),
        exam_types: examTypes.map((t) => ({ id: t.id, name: t.name, category: t.category })),
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing Advisor examination filters', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async assertMentorsClass(user: JwtPayload, classId: number): Promise<void> {
    const facultyId = await this.resolveFacultyId(user);
    const classIds = await this.menteeClassIds(facultyId);
    if (!classIds.includes(classId)) {
      throw new ForbiddenException({
        message: 'You are not the class advisor for this class.',
        errorCode: 'NOT_CLASS_MENTOR',
      });
    }
  }

  async getGrid(user: JwtPayload, classId: number, examTypeId: number) {
    await this.assertMentorsClass(user, classId);
    return this.examResultsGrid.buildGrid(classId, examTypeId);
  }

  async getGridExportTable(user: JwtPayload, classId: number, examTypeId: number): Promise<ReportTable> {
    await this.assertMentorsClass(user, classId);
    return this.examResultsGrid.buildGridExportTable(classId, examTypeId);
  }
}
