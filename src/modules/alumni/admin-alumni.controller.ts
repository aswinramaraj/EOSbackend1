import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { AlumniGraduationService } from './alumni-graduation.service';
import { AdminAlumniBatchesService } from './admin-alumni-batches.service';
import { AlumniAnnouncementsService } from './alumni-announcements.service';
import { CreateAlumniAnnouncementDto } from './dto/create-alumni-announcement.dto';

/** Admin-only alumni management: manual graduation, batch listing, announcements. */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminAlumniController {
  constructor(
    private readonly graduationService: AlumniGraduationService,
    private readonly batchesService: AdminAlumniBatchesService,
    private readonly announcementsService: AlumniAnnouncementsService,
  ) {}

  /**
   * POST /admin/alumni-batches/:batchId/graduate
   *
   * Runs the same graduation logic as the daily cron for one specific
   * batch, immediately. Returns 409 if that batch already has an
   * alumni_batches row (AlumniGraduationService.graduateBatch throws
   * ConflictException, which the global HttpExceptionFilter maps to 409).
   */
  @Post('alumni-batches/:batchId/graduate')
  graduateBatch(@Param('batchId', ParseIntPipe) batchId: number) {
    return this.graduationService.graduateBatch(batchId);
  }

  @Get('alumni-batches')
  listBatches(@Query() query: PaginationDto) {
    return this.batchesService.listBatches(query);
  }

  @Post('alumni-announcements')
  createAnnouncement(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAlumniAnnouncementDto,
  ) {
    return this.announcementsService.createAnnouncement(user.sub, dto);
  }
}
