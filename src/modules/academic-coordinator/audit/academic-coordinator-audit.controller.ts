import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { AcademicCoordinatorAuditService } from './academic-coordinator-audit.service';
import { GetAuditQueryDto } from './dto/get-audit-query.dto';

/** GET /api/v1/me/coordinator/audit — Academic Coordinator only, read-only. */
@Controller('me/coordinator/audit')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ACADEMIC_COORDINATOR)
export class AcademicCoordinatorAuditController {
  constructor(private readonly service: AcademicCoordinatorAuditService) {}

  @Get()
  audit(@Query() query: GetAuditQueryDto) {
    return this.service.audit(query.department_id, query.semester);
  }
}
