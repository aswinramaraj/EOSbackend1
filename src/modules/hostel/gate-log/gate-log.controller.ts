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
import { LookupStudentDto } from './dto/lookup-student.dto';

@Controller('hostel/gate-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
export class GateLogController {
  constructor(
    private readonly gateLogService: GateLogService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  async create(@Body() dto: CreateGateLogDto, @CurrentUser() user: JwtPayload) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    return this.gateLogService.create(dto, user.sub, wardenHostelId);
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

  @Get('pending-exits')
  findPendingExits() {
    return this.gateLogService.findPendingExits();
  }

  @Get('pending-returns')
  findPendingReturns() {
    return this.gateLogService.findPendingReturns();
  }

  /**
   * GET /hostel/gate-log/search?q=
   *
   * Type-ahead pick-list for the gate desk. Read-only.
   */
  @Get('search')
  searchStudents(@Query('q') q?: string) {
    return this.gateLogService.searchStudents(q ?? '');
  }

  @Get('lookup')
  lookup(@Query() query: LookupStudentDto) {
    return this.gateLogService.lookupByRollNo(query.roll_no);
  }
}
