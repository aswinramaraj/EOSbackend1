import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { AcademicCoordinatorResultsService } from './academic-coordinator-results.service';

/** GET /api/v1/me/coordinator/results/* — Academic Coordinator only, read-only. */
@Controller('me/coordinator/results')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ACADEMIC_COORDINATOR)
export class AcademicCoordinatorResultsController {
  constructor(private readonly service: AcademicCoordinatorResultsService) {}

  @Get('classes/:classId')
  classResults(@Param('classId', ParseIntPipe) classId: number) {
    return this.service.classResults(classId);
  }
}
