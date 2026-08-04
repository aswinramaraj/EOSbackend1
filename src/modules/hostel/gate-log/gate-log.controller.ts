import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { GateLogService } from './gate-log.service';
import { CreateGateLogDto } from './dto/create-gate-log.dto';
import { SearchGateLogDto } from './dto/search-gate-log.dto';

@Controller('hostel/gate-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN)
export class GateLogController {
  constructor(private readonly gateLogService: GateLogService) {}

  @Post()
  create(@Body() dto: CreateGateLogDto, @CurrentUser() user: JwtPayload) {
    return this.gateLogService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: SearchGateLogDto) {
    return this.gateLogService.findAll(query);
  }
}
