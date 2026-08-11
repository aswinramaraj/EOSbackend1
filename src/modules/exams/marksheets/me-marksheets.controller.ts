import { Controller, Get, NotFoundException, Param, ParseIntPipe, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Self-service marksheet access — GET /api/v1/me/marksheets[/:examId].
 * Mirrors MeHallTicketsController: the existing MarksheetsController only
 * exposes COE-facing generate/fetch routes keyed by an arbitrary studentId
 * param. Additive new controller, self-scoped from the JWT, reusing the
 * existing marksheets table — no schema change, no existing route touched.
 */
@Controller('me/marksheets')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.STUDENT)
export class MeMarksheetsController {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveStudentId(userId: number): Promise<number> {
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
    return student.id;
  }

  @Get()
  async findMine(@CurrentUser() user: JwtPayload) {
    const studentId = await this.resolveStudentId(user.sub);
    return this.prisma.marksheets.findMany({
      where: { student_id: studentId },
      select: {
        id: true,
        exam_id: true,
        file_url: true,
        generated_at: true,
        exams: { select: { title: true, academic_year: true, semester: true } },
      },
      orderBy: { generated_at: 'desc' },
    });
  }

  @Get(':examId')
  async findMineForExam(
    @Param('examId', ParseIntPipe) examId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    const studentId = await this.resolveStudentId(user.sub);
    const marksheet = await this.prisma.marksheets.findFirst({
      where: { exam_id: examId, student_id: studentId },
      select: {
        id: true,
        exam_id: true,
        file_url: true,
        generated_at: true,
        exams: { select: { title: true, academic_year: true, semester: true } },
      },
    });
    if (!marksheet) {
      throw new NotFoundException({
        message: 'Marksheet not found for this exam',
        errorCode: 'MARKSHEET_NOT_FOUND',
      });
    }
    return marksheet;
  }
}
