import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { HodEdcService } from './hod-edc.service';

@Controller('hod/edc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HOD)
export class HodEdcController {
  constructor(private readonly hodEdcService: HodEdcService) {}

  /** GET /api/v1/hod/edc?search=&batch_id=&department_id= */
  @Get()
  getRecords(
    @CurrentUser() user: JwtPayload,
    @Query('search') search?: string,
    @Query('batch_id') batchId?: string,
    @Query('department_id') departmentId?: string,
  ) {
    return this.hodEdcService.getRecords(
      user.sub,
      search,
      batchId ? Number(batchId) : undefined,
      departmentId ? Number(departmentId) : undefined,
    );
  }

  /** GET /api/v1/hod/edc/:id */
  @Get(':id')
  getProfile(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    return this.hodEdcService.getProfile(user.sub, Number(id));
  }
}
