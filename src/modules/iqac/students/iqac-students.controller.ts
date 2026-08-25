import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalStudentsService } from 'src/modules/principal/students/students.service';
import { ListPrincipalStudentsQueryDto } from 'src/modules/principal/students/dto/list-principal-students-query.dto';

/**
 * GET /api/v1/me/iqac/students/* — IQAC only, read-only.
 *
 * IQAC's own "Students" register. Delegates straight to
 * PrincipalStudentsService rather than forking a second, duplicate
 * real-data query — the underlying data (and its honest CGPA/arrears gaps)
 * is exactly the institution's, not something specific to either role.
 */
@Controller('me/iqac/students')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.IQAC)
export class IqacStudentsController {
  constructor(private readonly studentsService: PrincipalStudentsService) {}

  @Get('filters')
  filters() {
    return this.studentsService.filters();
  }

  @Get()
  list(@Query() query: ListPrincipalStudentsQueryDto) {
    return this.studentsService.list(query);
  }
}
