import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodHigherEducationService } from './hod-higher-education.service';

@Controller('hod/higher-education')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodHigherEducationController {
  constructor(
    private readonly hodHigherEducationService: HodHigherEducationService,
  ) {}

  /** GET /api/v1/hod/higher-education?search=&batch_id=&programme= */
  @Get()
  getRecords(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('batch_id') batchId?: string,
    @Query('programme') programme?: string,
  ) {
    return this.hodHigherEducationService.getRecords(
      user.sub,
      search,
      batchId ? Number(batchId) : undefined,
      programme,
    );
  }

  /** GET /api/v1/hod/higher-education/:id */
  @Get(':id')
  getProfile(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.hodHigherEducationService.getProfile(user.sub, Number(id));
  }
}
