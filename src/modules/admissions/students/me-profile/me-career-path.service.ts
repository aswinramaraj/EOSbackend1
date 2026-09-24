import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { CareerPath } from './dto/update-career-path.dto';

/**
 * `students.career_path` is real once career_path.query.md runs — read via
 * $queryRaw since it predates a `prisma db pull`, same pattern as
 * DrivesService's eligible_department_codes. Degrades to `null` ("not yet
 * declared") on read when the column is missing.
 *
 * Read-only from the student side on purpose: this is staff-set (Placement
 * Officer marks Placement/Venture/Higher Studies on the Students page, see
 * DrivesService.setStudentCareerPath), not a student self-service choice —
 * a student only ever reads their own value here, to decide which of those
 * three tabs their own sidebar shows.
 */
@Injectable()
export class MeCareerPathService {
  constructor(private readonly prisma: PrismaService) {}

  async getMyCareerPath(userId: number) {
    const student = await this.findStudentOrThrow(userId);
    return this.computeCareerPath(student.id);
  }

  /**
   * Same computation as getMyCareerPath, but for a student chosen by id
   * rather than resolved from the caller's own JWT - used by ParentsService
   * to gate the same career-path-tagged nav items (Placements/My
   * Venture/Higher Studies) by the child's own declared path.
   */
  async getCareerPathForStudentId(studentId: number) {
    return this.computeCareerPath(studentId);
  }

  private async computeCareerPath(studentId: number) {
    try {
      const rows = await this.prisma.$queryRaw<
        { career_path: CareerPath | null }[]
      >`
        SELECT career_path FROM students WHERE id = ${studentId}
      `;
      return { career_path: rows[0]?.career_path ?? null };
    } catch {
      return { career_path: null };
    }
  }

  private async findStudentOrThrow(userId: number) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    return student;
  }
}
