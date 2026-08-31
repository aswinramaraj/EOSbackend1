import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import { resolveWardenHostelId } from '../common/warden-scope.util';
import { HostelFeesService } from './fees.service';
import { SearchHostelFeesDto } from './dto/search-hostel-fees.dto';

@Controller('hostel/fees')
@UseGuards(JwtAuthGuard, RolesGuard)
// Gate warden deliberately NOT granted: their duty is the gate log
// (check-in/check-out) only, and the gate-warden screens call no
// endpoint on this controller. Hostel residents' complaints, fees,
// leave and attendance are warden/admin business.
@Roles(ROLES.ADMIN, ROLES.WARDEN)
export class HostelFeesController {
  constructor(
    private readonly feesService: HostelFeesService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async findAll(
    @Query() query: SearchHostelFeesDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    if (wardenHostelId != null) query.hostel_id = wardenHostelId;
    return this.feesService.findAll(query);
  }

  /**
   * POST /hostel/fees/reconcile — links every hostel resident to the real
   * hostel fee structure and generates their fee demand if missing. Idempotent;
   * safe to call again after new residents are allocated to rooms.
   */
  @Post('reconcile')
  async reconcile() {
    return this.feesService.reconcileFeeAssignments();
  }
}
