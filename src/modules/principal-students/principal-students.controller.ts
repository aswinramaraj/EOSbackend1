import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalStudentsService } from './principal-students.service';
import { ListPrincipalStudentsQueryDto } from './dto/list-principal-students-query.dto';

@Controller('principal-students')
@UseGuards(JwtAuthGuard, RolesGuard)
// Secretary added alongside Principal — same institution-wide posture as
// the /announcements module (no secretary→department table exists
// anywhere in the schema, so Secretary reads the same unscoped aggregates
// Principal does, rather than a fabricated department-filtered view).
@Roles(ROLES.PRINCIPAL, ROLES.SECRETARY)
export class PrincipalStudentsController {
  constructor(private readonly service: PrincipalStudentsService) {}

  /** GET /principal-students — search/filter the institution-wide student directory. */
  @Get()
  search(@Query() query: ListPrincipalStudentsQueryDto) {
    return this.service.search(query);
  }

  /** GET /principal-students/roll-count — total students on roll (unfiltered). */
  @Get('roll-count')
  async getRollCount() {
    const count = await this.service.getRollCount();
    return { count };
  }

  /** GET /principal-students/attendance-overview — 4 stat cards + department breakdown. */
  @Get('attendance-overview')
  getAttendanceOverview() {
    return this.service.getAttendanceOverview();
  }

  /** GET /principal-students/:id/profile — full Student Profile detail screen. */
  @Get(':id/profile')
  getProfile(@Param('id', ParseIntPipe) id: number) {
    return this.service.getStudentProfile(id);
  }
}
