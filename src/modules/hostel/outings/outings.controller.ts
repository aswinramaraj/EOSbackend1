import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import { resolveWardenHostelId } from '../common/warden-scope.util';
import { OutingsService } from './outings.service';
import { SearchOutingsDto } from './dto/search-outings.dto';
import { DecideOutingDto } from './dto/decide-outing.dto';

@Controller('hostel/outings')
@UseGuards(JwtAuthGuard, RolesGuard)
// Gate warden deliberately NOT granted: their duty is the gate log
// (check-in/check-out) only, and the gate-warden screens call no
// endpoint on this controller. Hostel residents' complaints, fees,
// leave and attendance are warden/admin business.
@Roles(ROLES.ADMIN, ROLES.WARDEN)
export class OutingsController {
  constructor(
    private readonly outingsService: OutingsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  async findAll(
    @Query() query: SearchOutingsDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    if (wardenHostelId != null) query.hostel_id = wardenHostelId;
    return this.outingsService.findAll(query);
  }

  @Patch(':id/decision')
  async decide(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DecideOutingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    return this.outingsService.decide(id, dto, user.sub, wardenHostelId);
  }
}
