import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';
import { SeatingPlansService } from './seating-plans.service';
import { OverviewQueryDto } from './dto/overview-query.dto';
import { VenueDetailQueryDto } from './dto/venue-detail-query.dto';
import { ConfigureVenueDto } from './dto/configure-venue.dto';
import { TargetVenueDto } from './dto/target-venue.dto';
import { AllocateManualDto } from './dto/allocate-manual.dto';
import { ListVersionsQueryDto } from './dto/list-versions-query.dto';

/**
 * New, COE-only module built entirely over tables that already existed —
 * seating_plan_versions, seating_plan_version_venues,
 * seating_plan_venue_departments, seating_arrangements — but had zero
 * controllers referencing them before this. No schema change of any kind.
 * Doesn't touch the older, simpler `seating-arrangements` controller.
 */
@Controller('seating-plans')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class SeatingPlansController {
  constructor(private readonly seatingPlansService: SeatingPlansService) {}

  @Get('overview')
  async getOverview(@Query() query: OverviewQueryDto) {
    const overview = await this.seatingPlansService.getOverview(query);
    return ApiResponse.ok(overview, 'Seating overview fetched successfully.');
  }

  @Get('venue-detail')
  async getVenueDetail(@Query() query: VenueDetailQueryDto) {
    const detail = await this.seatingPlansService.getVenueDetail(query);
    return ApiResponse.ok(detail, 'Venue detail fetched successfully.');
  }

  @Get('versions')
  async listVersions(@Query() query: ListVersionsQueryDto) {
    const versions = await this.seatingPlansService.listVersions(query);
    return ApiResponse.ok(versions, 'Seating plan versions fetched successfully.');
  }

  @Get('versions/:id')
  async getVersionDetail(@Param('id', ParseIntPipe) id: number) {
    const detail = await this.seatingPlansService.getVersionDetail(id);
    return ApiResponse.ok(detail, 'Seating plan version fetched successfully.');
  }

  @Delete('versions/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteVersion(@Param('id', ParseIntPipe) id: number) {
    await this.seatingPlansService.deleteVersion(id);
  }

  @Post('venue-config')
  async configureVenue(@Body() dto: ConfigureVenueDto) {
    const detail = await this.seatingPlansService.configureVenue(dto);
    return ApiResponse.ok(detail, 'Venue configuration saved successfully.');
  }

  @Post('allocate-automatic')
  async allocateAutomatic(@Body() dto: TargetVenueDto) {
    const result = await this.seatingPlansService.allocateAutomatic(dto);
    return ApiResponse.ok(result, 'Seats allocated automatically.');
  }

  @Post('allocate-manual')
  async allocateManual(@Body() dto: AllocateManualDto) {
    const result = await this.seatingPlansService.allocateManual(dto);
    return ApiResponse.ok(result, 'Seats allocated manually.');
  }

  @Post('clear-venue')
  async clearVenue(@Body() dto: TargetVenueDto) {
    const result = await this.seatingPlansService.clearVenue(dto);
    return ApiResponse.ok(result, 'Venue seating cleared.');
  }

  @Post('versions/:id/submit')
  async submitVersion(@Param('id', ParseIntPipe) id: number) {
    const version = await this.seatingPlansService.submitVersion(id);
    return ApiResponse.ok(version, 'Seating plan submitted for verification.');
  }

  @Post('versions/:id/publish')
  async publishVersion(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: JwtPayload) {
    const version = await this.seatingPlansService.publishVersion(id, user.sub);
    return ApiResponse.ok(version, 'Seating plan published successfully.');
  }
}
