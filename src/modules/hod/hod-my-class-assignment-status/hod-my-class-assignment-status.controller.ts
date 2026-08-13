import { Body, Controller, Get, Patch, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodMyClassAssignmentStatusService } from './hod-my-class-assignment-status.service';
import { MarkAssignmentStatusDto } from './dto/mark-assignment-status.dto';

@Controller('hod/my-class/assignment-status')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodMyClassAssignmentStatusController {
  constructor(
    private readonly hodMyClassAssignmentStatusService: HodMyClassAssignmentStatusService,
  ) {}

  /** GET /api/v1/hod/my-class/assignment-status?class_id=&subject_id=&assignment_id= */
  @Get()
  getOverview(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
    @Query('assignment_id') assignmentId?: string,
  ) {
    return this.hodMyClassAssignmentStatusService.getOverview(
      user.sub,
      classId ? Number(classId) : undefined,
      subjectId ? Number(subjectId) : undefined,
      assignmentId ? Number(assignmentId) : undefined,
    );
  }

  /** PATCH /api/v1/hod/my-class/assignment-status/mark */
  @Patch('mark')
  mark(@CurrentUser() user: JwtPayload, @Body() dto: MarkAssignmentStatusDto) {
    return this.hodMyClassAssignmentStatusService.mark(
      user.sub,
      dto.assignment_id,
      dto.student_id,
      dto.status_id,
      dto.is_submitted,
    );
  }
}
