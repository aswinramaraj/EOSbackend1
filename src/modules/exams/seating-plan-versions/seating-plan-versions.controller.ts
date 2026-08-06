import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SeatingPlanVersionsService } from './seating-plan-versions.service';
import { CreateSeatingPlanVersionDto } from './dto/create-seating-plan-version.dto';
import { ListSeatingPlanVersionsQueryDto } from './dto/list-seating-plan-versions-query.dto';
import { PublishSeatingPlanVersionDto } from './dto/publish-seating-plan-version.dto';
import { AddVersionVenueDto } from './dto/add-version-venue.dto';
import { UpdateVersionVenueDto } from './dto/update-version-venue.dto';
import { AllocateVersionVenueDto } from './dto/allocate-version-venue.dto';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { SeniorCoeGuard } from 'src/auth/guards/senior-coe.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ApiResponse, ROLES } from 'src/common';

/**
 * Draft -> ready_to_publish -> published -> superseded/withdrawn workflow
 * for seating at one exam+date+session — mirrors exam-timetable-versions.
 * Every route is COE-gated (draft seating plans aren't world-readable).
 */
@Controller('seating-plan-versions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.COE)
export class SeatingPlanVersionsController {
  constructor(private readonly versionsService: SeatingPlanVersionsService) {}

  @Post()
  async create(
    @Body() dto: CreateSeatingPlanVersionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const version = await this.versionsService.create(dto, user.sub);
    return ApiResponse.created(
      version,
      'Seating plan version created successfully.',
    );
  }

  @Get()
  async findAll(@Query() query: ListSeatingPlanVersionsQueryDto) {
    const versions = await this.versionsService.findAll(query);
    return ApiResponse.ok(
      versions,
      'Seating plan versions fetched successfully.',
    );
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const version = await this.versionsService.findOne(id);
    return ApiResponse.ok(
      version,
      'Seating plan version fetched successfully.',
    );
  }

  @Patch(':id/ready-to-publish')
  async readyToPublish(@Param('id', ParseIntPipe) id: number) {
    const version = await this.versionsService.readyToPublish(id);
    return ApiResponse.ok(version, 'Seating plan version staged for publish.');
  }

  @Patch(':id/return-to-drafts')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  async returnToDrafts(@Param('id', ParseIntPipe) id: number) {
    const version = await this.versionsService.returnToDrafts(id);
    return ApiResponse.ok(version, 'Seating plan version returned to drafts.');
  }

  @Patch(':id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  async publish(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PublishSeatingPlanVersionDto,
    @CurrentUser() user: JwtPayload,
  ) {
    const version = await this.versionsService.publish(id, dto, user.sub);
    return ApiResponse.ok(
      version,
      'Seating plan version published successfully.',
    );
  }

  @Patch(':id/withdraw')
  @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
  async withdraw(@Param('id', ParseIntPipe) id: number) {
    const version = await this.versionsService.withdraw(id);
    return ApiResponse.ok(version, 'Seating plan version withdrawn.');
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const result = await this.versionsService.remove(id);
    return ApiResponse.ok(result, 'Seating plan version deleted successfully.');
  }

  @Post(':id/venues')
  async addVenue(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddVersionVenueDto,
  ) {
    const venue = await this.versionsService.addVenue(id, dto);
    return ApiResponse.created(venue, 'Venue added to seating plan version.');
  }

  @Patch(':id/venues/:venueId')
  async updateVenue(
    @Param('id', ParseIntPipe) id: number,
    @Param('venueId', ParseIntPipe) venueId: number,
    @Body() dto: UpdateVersionVenueDto,
  ) {
    const venue = await this.versionsService.updateVenue(id, venueId, dto);
    return ApiResponse.ok(venue, 'Venue configuration updated.');
  }

  @Delete(':id/venues/:venueId')
  async removeVenue(
    @Param('id', ParseIntPipe) id: number,
    @Param('venueId', ParseIntPipe) venueId: number,
  ) {
    const result = await this.versionsService.removeVenue(id, venueId);
    return ApiResponse.ok(result, 'Venue removed from seating plan version.');
  }

  @Post(':id/venues/:venueId/allocate')
  async allocateVenue(
    @Param('id', ParseIntPipe) id: number,
    @Param('venueId', ParseIntPipe) venueId: number,
    @Body() dto: AllocateVersionVenueDto,
  ) {
    const seating = await this.versionsService.allocateVenue(id, venueId, dto);
    return ApiResponse.ok(seating, 'Seats allocated successfully.');
  }

  @Delete(':id/venues/:venueId/allocation')
  async clearVenueAllocation(
    @Param('id', ParseIntPipe) id: number,
    @Param('venueId', ParseIntPipe) venueId: number,
  ) {
    const result = await this.versionsService.clearVenueAllocation(id, venueId);
    return ApiResponse.ok(result, 'Seating cleared for this venue.');
  }
}
