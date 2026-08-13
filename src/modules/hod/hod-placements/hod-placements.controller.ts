import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodPlacementsService } from './hod-placements.service';

@Controller('hod/placements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodPlacementsController {
  constructor(private readonly hodPlacementsService: HodPlacementsService) {}

  /** GET /api/v1/hod/placements/students?search=&class_id= */
  @Get('students')
  getStudentRecords(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('class_id') classId?: string,
  ) {
    return this.hodPlacementsService.getStudentRecords(
      user.sub,
      search,
      classId ? Number(classId) : undefined,
    );
  }

  /** GET /api/v1/hod/placements/drives — campus-wide upcoming drives. */
  @Get('drives')
  getUpcomingDrives() {
    return this.hodPlacementsService.getUpcomingDrives();
  }

  /** GET /api/v1/hod/placements/history — this department's own placement outcomes by batch. */
  @Get('history')
  getHistory(@CurrentUser() user: JwtPayload) {
    return this.hodPlacementsService.getHistory(user.sub);
  }
}
