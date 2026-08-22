import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { AcademicCoordinatorMappingService } from './academic-coordinator-mapping.service';
import { GetMappingQueryDto } from './dto/get-mapping-query.dto';
import { MutateMappingDto } from './dto/mutate-mapping.dto';

/** /api/v1/me/coordinator/mapping/* — Academic Coordinator only. */
@Controller('me/coordinator/mapping')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ACADEMIC_COORDINATOR)
export class AcademicCoordinatorMappingController {
  constructor(private readonly service: AcademicCoordinatorMappingService) {}

  @Get()
  get(@Query() query: GetMappingQueryDto) {
    return this.service.getMapping(query.department_id, query.semester);
  }

  @Post('add')
  add(@Body() dto: MutateMappingDto) {
    return this.service.addMapping(
      dto.department_id,
      dto.semester,
      dto.subject_id,
    );
  }

  @Post('remove')
  remove(@Body() dto: MutateMappingDto) {
    return this.service.removeMapping(
      dto.department_id,
      dto.semester,
      dto.subject_id,
    );
  }
}
