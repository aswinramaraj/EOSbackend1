import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import { resolveWardenHostelId } from '../common/warden-scope.util';
import { GateLogService } from './gate-log.service';
import { CreateGateLogDto } from './dto/create-gate-log.dto';
import { SearchGateLogDto } from './dto/search-gate-log.dto';

@Controller('hostel/gate-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
export class GateLogController {
  constructor(
    private readonly gateLogService: GateLogService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  create(@Body() dto: CreateGateLogDto, @CurrentUser() user: JwtPayload) {
    return this.gateLogService.create(dto, user.sub);
  }

  @Get()
  async findAll(
    @Query() query: SearchGateLogDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    if (wardenHostelId != null) query.hostel_id = wardenHostelId;
    return this.gateLogService.findAll(query);
  }
}
