import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodMyClassSubjectRecordsService } from './hod-my-class-subject-records.service';

@Controller('hod/my-class/subject-records')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodMyClassSubjectRecordsController {
  constructor(
    private readonly hodMyClassSubjectRecordsService: HodMyClassSubjectRecordsService,
  ) {}

  /** GET /api/v1/hod/my-class/subject-records?class_id=&subject_id=&semester= */
  @Get()
  getOverview(
    @CurrentUser() user: JwtPayload,
    @Query('class_id') classId?: string,
    @Query('subject_id') subjectId?: string,
    @Query('semester') semester?: string,
  ) {
    return this.hodMyClassSubjectRecordsService.getOverview(
      user.sub,
      classId ? Number(classId) : undefined,
      subjectId ? Number(subjectId) : undefined,
      semester ? Number(semester) : undefined,
    );
  }
}
