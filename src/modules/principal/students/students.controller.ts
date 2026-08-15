import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalStudentsService } from './students.service';
import { ListPrincipalStudentsQueryDto } from './dto/list-principal-students-query.dto';

/** GET /api/v1/me/principal/students/* — Principal only, read-only. */
@Controller('me/principal/students')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalStudentsController {
  constructor(private readonly studentsService: PrincipalStudentsService) {}

  @Get('filters')
  filters() {
    return this.studentsService.filters();
  }

  @Get('summary')
  summary() {
    return this.studentsService.summary();
  }

  @Get()
  list(@Query() query: ListPrincipalStudentsQueryDto) {
    return this.studentsService.list(query);
  }
}
