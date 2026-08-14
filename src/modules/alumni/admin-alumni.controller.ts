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
import { AdminAlumniGroupsService } from './admin-alumni-groups.service';
import { AlumniAnnouncementsService } from './alumni-announcements.service';
import { CreateAlumniAnnouncementDto } from './dto/create-alumni-announcement.dto';
import { CreateAlumniMessageDto } from './dto/create-alumni-message.dto';

/**
 * Admin-only alumni management: manual graduation, batch listing,
 * announcements. Principal is also granted the browse/post routes (batch
 * list, a specific batch's group + chat, announcements) but NOT graduation
 * itself — triggering a batch's graduation is a one-way admin action this
 * feature never asked to expose to Principal.
 */
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
export class AdminAlumniController {
  constructor(
    private readonly graduationService: AlumniGraduationService,
    private readonly batchesService: AdminAlumniBatchesService,
    private readonly groupsService: AdminAlumniGroupsService,
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
  @Roles(ROLES.ADMIN, ROLES.PRINCIPAL)
  listBatches(@Query() query: PaginationDto) {
    return this.batchesService.listBatches(query);
  }

  /** GET /admin/alumni-batches/:alumniBatchId — a specific group's header info. */
  @Get('alumni-batches/:alumniBatchId')
  @Roles(ROLES.ADMIN, ROLES.PRINCIPAL)
  getGroupDetail(@Param('alumniBatchId', ParseIntPipe) alumniBatchId: number) {
    return this.groupsService.getGroupDetail(alumniBatchId);
  }

  /** GET /admin/alumni-batches/:alumniBatchId/timeline — real messages + real join events, merged. */
  @Get('alumni-batches/:alumniBatchId/timeline')
  @Roles(ROLES.ADMIN, ROLES.PRINCIPAL)
  getTimeline(@Param('alumniBatchId', ParseIntPipe) alumniBatchId: number) {
    return this.groupsService.listTimeline(alumniBatchId);
  }

  /** POST /admin/alumni-batches/:alumniBatchId/messages — posts as the caller (not as an alumnus). */
  @Post('alumni-batches/:alumniBatchId/messages')
  @Roles(ROLES.ADMIN, ROLES.PRINCIPAL)
  postMessage(
    @Param('alumniBatchId', ParseIntPipe) alumniBatchId: number,
    @Body() dto: CreateAlumniMessageDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.groupsService.createMessageForBatch(user.sub, alumniBatchId, dto);
  }

  @Post('alumni-announcements')
  @Roles(ROLES.ADMIN, ROLES.PRINCIPAL)
  createAnnouncement(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateAlumniAnnouncementDto,
  ) {
    return this.announcementsService.createAnnouncement(user.sub, dto);
  }
}
