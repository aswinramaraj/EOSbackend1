import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { HigherEducationApplicationsService } from './higher-education-applications.service';
import { CreateApplicationWindowDto } from './dto/create-application-window.dto';

@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.HIGHER_EDUCATION)
export class HigherEducationApplicationsController {
  constructor(private readonly service: HigherEducationApplicationsService) {}

  /** GET /api/v1/me/higher-education-applications — filed/evaluation/offers KPIs plus the open application-window register. */
  @Get('higher-education-applications')
  getApplications() {
    return this.service.getApplications();
  }

  /** POST /api/v1/me/higher-education-application-windows — add an application window to the register. */
  @Post('higher-education-application-windows')
  @HttpCode(HttpStatus.CREATED)
  createApplicationWindow(@Body() dto: CreateApplicationWindowDto) {
    return this.service.createApplicationWindow(dto);
  }
}
