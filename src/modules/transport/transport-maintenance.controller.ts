import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { TransportMaintenanceService } from './transport-maintenance.service';
import { CreateServiceLogDto } from './dto/create-service-log.dto';

@Controller('me/maintenance')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.TRANSPORT)
export class TransportMaintenanceController {
  constructor(private readonly service: TransportMaintenanceService) {}

  /** GET /api/v1/me/maintenance — service-due list + service/repair log. */
  @Get()
  getMaintenance() {
    return this.service.getMaintenance();
  }

  /** POST /api/v1/me/maintenance/service-log — record a service/repair entry. */
  @Post('service-log')
  @HttpCode(HttpStatus.CREATED)
  createServiceLogEntry(@Body() dto: CreateServiceLogDto, @CurrentUser() user: JwtPayload) {
    return this.service.createServiceLogEntry(dto, user.sub);
  }
}
