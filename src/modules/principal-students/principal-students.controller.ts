import { Controller, Get, Param, ParseIntPipe, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalStudentsService } from './principal-students.service';
import { ListPrincipalStudentsQueryDto } from './dto/list-principal-students-query.dto';

@Controller('principal-students')
@UseGuards(JwtAuthGuard, RolesGuard)
// Secretary added alongside Principal — Secretary is forced to her own
// department (via non_teaching_staff.department_id) inside the service,
// same department-scoping pattern as HOD; Principal/Admin stay institution-wide.
@Roles(ROLES.PRINCIPAL, ROLES.SECRETARY)
export class PrincipalStudentsController {
  constructor(private readonly service: PrincipalStudentsService) {}

  /** GET /principal-students — search/filter the institution-wide student directory. */
  @Get()
  search(@Query() query: ListPrincipalStudentsQueryDto, @CurrentUser() user: JwtPayload) {
    return this.service.search(query, user);
  }

  /** GET /principal-students/roll-count — total students on roll (unfiltered for Principal; own-department for Secretary). */
  @Get('roll-count')
  async getRollCount(@CurrentUser() user: JwtPayload) {
    const count = await this.service.getRollCount(user);
    return { count };
  }

  /** GET /principal-students/attendance-overview — 4 stat cards + department breakdown. */
  @Get('attendance-overview')
  getAttendanceOverview(@CurrentUser() user: JwtPayload) {
    return this.service.getAttendanceOverview(user);
  }

  /** GET /principal-students/:id/profile — full Student Profile detail screen. */
  @Get(':id/profile')
  getProfile(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    return this.service.getStudentProfile(id, user);
  }

  /**
   * GET /principal-students/:id/profile/export?format=csv|excel|pdf —
   * the "Export CSV"/"Export PDF" buttons on the Student Profile screen.
   * Same @Res()-and-manual-headers pattern as
   * PrincipalReportsController.scorecard() (that route also opts out of
   * the global TransformInterceptor to send a raw file buffer).
   */
  @Get(':id/profile/export')
  async exportProfile(
    @Param('id', ParseIntPipe) id: number,
    @Query('format') format: 'csv' | 'excel' | 'pdf' = 'pdf',
    @CurrentUser() user: JwtPayload,
    @Res() res: Response,
  ) {
    const { buffer, contentType, filename } = await this.service.exportStudentProfile(id, user, format);
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.send(buffer);
  }
}
