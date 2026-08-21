import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalFacultyService } from './faculty.service';
import { ListPrincipalFacultyQueryDto } from './dto/list-principal-faculty-query.dto';

/** GET /api/v1/me/principal/faculty/* — Principal only, read-only. */
@Controller('me/principal/faculty')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalFacultyController {
  constructor(private readonly facultyService: PrincipalFacultyService) {}

  @Get('filters')
  filters() {
    return this.facultyService.filters();
  }

  @Get('summary')
  summary() {
    return this.facultyService.summary();
  }

  @Get('department-strength')
  departmentStrength() {
    return this.facultyService.departmentStrength();
  }

  @Get()
  list(@Query() query: ListPrincipalFacultyQueryDto) {
    return this.facultyService.list(query);
  }
}
