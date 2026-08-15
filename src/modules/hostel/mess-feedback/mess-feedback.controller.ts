import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrismaService } from 'src/prisma/prisma.service';
import { resolveWardenHostelId } from '../common/warden-scope.util';
import { MessFeedbackService } from './mess-feedback.service';
import { CreateMessFeedbackDto } from './dto/create-mess-feedback.dto';
import { SearchMessFeedbackDto } from './dto/search-mess-feedback.dto';

@Controller('hostel/mess-feedback')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN, ROLES.GATE_WARDEN, ROLES.WARDEN)
export class MessFeedbackController {
  constructor(
    private readonly messFeedbackService: MessFeedbackService,
    private readonly prisma: PrismaService,
  ) {}

  @Post()
  create(@Body() dto: CreateMessFeedbackDto) {
    return this.messFeedbackService.create(dto);
  }

  @Get()
  async findAll(
    @Query() query: SearchMessFeedbackDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const wardenHostelId = await resolveWardenHostelId(this.prisma, user.sub);
    if (wardenHostelId != null) query.hostel_id = wardenHostelId;
    return this.messFeedbackService.findAll(query);
  }
}
