import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalStudentsService } from './principal-students.service';
import { ListPrincipalStudentsQueryDto } from './dto/list-principal-students-query.dto';

@Controller('principal-students')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
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
}
