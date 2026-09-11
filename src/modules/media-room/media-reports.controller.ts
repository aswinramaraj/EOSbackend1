import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { MediaRoomReportsService } from './media-reports.service';
import {
  CreateReportDto,
  SetScorecardTargetDto,
  UpdateReportDto,
} from './dto/media-report.dto';

/**
 * Saved reports plus the three read-only analytics panels.
 *
 * Route order matters: the literal `analytics`, `scorecard` and
 * `app-performance` segments are declared before `media-reports/:id`, or the
 * parameterised route would capture them and ParseIntPipe would reject the
 * request as a bad id.
 */
@Controller('me')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.MEDIA_ROOM, ROLES.ADMIN)
export class MediaRoomReportsController {
  constructor(private readonly service: MediaRoomReportsService) {}

  /** GET /api/v1/me/media-reports/analytics */
  @Get('media-reports/analytics')
  analytics() {
    return this.service.analytics();
  }

  /** GET /api/v1/me/media-reports/scorecard */
  @Get('media-reports/scorecard')
  scorecard() {
    return this.service.scorecard();
  }

  /** GET /api/v1/me/media-reports/app-performance */
  @Get('media-reports/app-performance')
  appPerformance() {
    return this.service.appPerformance();
  }

  /** PUT /api/v1/me/media-reports/scorecard/targets/:metricKey */
  @Put('media-reports/scorecard/targets/:metricKey')
  setTarget(
    @Param('metricKey') metricKey: string,
    @Body() dto: SetScorecardTargetDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.setTarget(metricKey, dto.target_value, user.sub);
  }

  /** GET /api/v1/me/media-reports */
  @Get('media-reports')
  list() {
    return this.service.list();
  }

  /** POST /api/v1/me/media-reports */
  @Post('media-reports')
  create(@Body() dto: CreateReportDto, @CurrentUser() user: JwtPayload) {
    return this.service.create(dto, user.sub);
  }

  /** PATCH /api/v1/me/media-reports/:id */
  @Patch('media-reports/:id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateReportDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.update(id, dto, user.sub);
  }

  /** DELETE /api/v1/me/media-reports/:id */
  @Delete('media-reports/:id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.service.remove(id, user);
  }
}
