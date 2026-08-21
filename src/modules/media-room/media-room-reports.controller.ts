import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomReportsService } from './media-room-reports.service';
import { CreateReportDto } from './dto/create-report.dto';
import { UpdateReportDto } from './dto/update-report.dto';
import { SetScorecardTargetDto } from './dto/set-scorecard-target.dto';

@Controller('me/media-reports')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM)
export class MediaRoomReportsController {
  constructor(private readonly service: MediaRoomReportsService) {}

  /** GET /api/v1/me/media-reports */
  @Get()
  findAll() {
    return this.service.findAll();
  }

  /** GET /api/v1/me/media-reports/analytics — real "Requests by department" + "Turnaround time" panels. */
  @Get('analytics')
  analytics() {
    return this.service.analytics();
  }

  /** GET /api/v1/me/media-reports/scorecard — real "Media scorecard" (this year / last year / target / attainment). */
  @Get('scorecard')
  scorecard() {
    return this.service.scorecard();
  }

  /** PUT /api/v1/me/media-reports/scorecard/targets/:metricKey — Media Room sets this AY's goal for one metric. */
  @Put('scorecard/targets/:metricKey')
  setScorecardTarget(@Param('metricKey') metricKey: string, @Body() dto: SetScorecardTargetDto, @CurrentUser() user: JwtPayload) {
    return this.service.setScorecardTarget(metricKey, dto.target_value, user.sub);
  }

  /** GET /api/v1/me/media-reports/app-performance — Dashboard's real "App performance" panel. */
  @Get('app-performance')
  appPerformance() {
    return this.service.appPerformance();
  }

  /** POST /api/v1/me/media-reports */
  @Post()
  create(@Body() dto: CreateReportDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-reports/:id */
  @Patch(':id')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateReportDto) {
    return this.service.updateStatus(id, dto);
  }

  /** DELETE /api/v1/me/media-reports/:id */
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.service.remove(id);
  }
}
