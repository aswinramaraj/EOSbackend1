import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { AcademicCoordinatorCopoService } from './academic-coordinator-copo.service';
import { AddProgramOutcomeDto } from './dto/add-program-outcome.dto';
import { AddCourseOutcomeDto } from './dto/add-course-outcome.dto';
import { SetMappingDto } from './dto/set-mapping.dto';

/** /api/v1/me/coordinator/copo/* — Academic Coordinator only. */
@Controller('me/coordinator/copo')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ACADEMIC_COORDINATOR)
export class AcademicCoordinatorCopoController {
  constructor(private readonly service: AcademicCoordinatorCopoService) {}

  @Get('subjects/:subjectId/matrix')
  getMatrix(@Param('subjectId', ParseIntPipe) subjectId: number) {
    return this.service.getMatrix(subjectId);
  }

  @Post('program-outcomes')
  addProgramOutcome(@Body() dto: AddProgramOutcomeDto) {
    return this.service.addProgramOutcome(
      dto.department_id,
      dto.code,
      dto.description,
    );
  }

  @Post('course-outcomes')
  addCourseOutcome(@Body() dto: AddCourseOutcomeDto) {
    return this.service.addCourseOutcome(
      dto.subject_id,
      dto.code,
      dto.description,
    );
  }

  @Post('mapping')
  setMapping(@Body() dto: SetMappingDto) {
    return this.service.setMapping(
      dto.course_outcome_id,
      dto.program_outcome_id,
      dto.correlation_level,
    );
  }
}
