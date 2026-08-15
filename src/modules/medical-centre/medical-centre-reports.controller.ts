import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { MedicalCentreReportsService } from './medical-centre-reports.service';

@Controller('me/medical-centre-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDICAL_CENTRE)
export class MedicalCentreReportsController {
  constructor(private readonly reportsService: MedicalCentreReportsService) {}

  @Get()
  getReports(@Query('year') year?: string) {
    return this.reportsService.getReports(year ? Number(year) : undefined);
  }
}
