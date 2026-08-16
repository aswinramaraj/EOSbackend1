import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  ParseIntPipe,
  Delete,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { VenuesService } from './venues.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { CreateVenueBookingDto } from './dto/create-venue-booking.dto';
import { ListVenueQueryDto } from './dto/list-venue-query.dto';
import { ReviewVenueBookingDto } from './dto/review-venue-booking.dto';
import { ListVenueBookingQueryDto } from './dto/list-venue-booking-query.dto';

/**
 * No class-level @Controller() prefix — Nest always prepends one to every
 * route on the class, and this controller needs two different top-level
 * paths (venues/... and venue-bookings/...). Each method spells out its own
 * full path instead, same as AnnouncementsController.
 */
@Controller()
export class VenuesController {
  constructor(private readonly venuesService: VenuesService) {}

  /** POST /api/v1/venues — Admin only. */
  @Post('venues')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createVenueDto: CreateVenueDto) {
    return this.venuesService.create(createVenueDto);
  }

  /**
   * GET /api/v1/venues?from=...&to=...&page=...&limit=... — any authenticated
   * user. Read-only availability check; no department/ownership filtering.
   */
  @Get('venues')
  @UseGuards(JwtAuthGuard)
  findAll(@Query() query: ListVenueQueryDto) {
    return this.venuesService.findAll(query);
  }

  /** GET /api/v1/venues/:id — any authenticated user. Static venue details. */
  @Get('venues/:id')
  @UseGuards(JwtAuthGuard)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.venuesService.findOne(id);
  }

  /** PATCH /api/v1/venues/:id — Admin only. */
  @Patch('venues/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateVenueDto: UpdateVenueDto,
  ) {
    return this.venuesService.update(id, updateVenueDto);
  }

  /** DELETE /api/v1/venues/:id — Admin only. */
  @Delete('venues/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.ADMIN)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.venuesService.remove(id);
  }

  /**
   * POST /api/v1/venue-bookings — HoD / Faculty / Placement / IQAC / HR Payroll.
   * Always submitted as 'pending'; never auto-approved.
   */
  @Post('venue-bookings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.HOD, ROLES.FACULTY, ROLES.PLACEMENT, ROLES.IQAC, ROLES.HR_PAYROLL, ROLES.SECRETARY)
  @HttpCode(HttpStatus.CREATED)
  createBooking(
    @Body() dto: CreateVenueBookingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.venuesService.createBooking(dto, user.sub);
  }

  /**
   * GET /api/v1/venue-bookings — IQAC (all) / HoD-Faculty-Placement-HR Payroll (own only).
   */
  @Get('venue-bookings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.IQAC, ROLES.HOD, ROLES.FACULTY, ROLES.PLACEMENT, ROLES.HR_PAYROLL, ROLES.SECRETARY)
  findAllBookings(
    @Query() query: ListVenueBookingQueryDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.venuesService.findAllBookings(query, user);
  }

  /**
   * GET /api/v1/venue-bookings/:id — IQAC (any) / HoD-Faculty-Placement-HR Payroll (own only).
   */
  @Get('venue-bookings/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.IQAC, ROLES.HOD, ROLES.FACULTY, ROLES.PLACEMENT, ROLES.HR_PAYROLL, ROLES.SECRETARY)
  findOneBooking(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.venuesService.findOneBooking(id, user);
  }

  /**
   * PATCH /api/v1/venue-bookings/:id — IQAC only.
   * Reviews a pending booking: approves, rejects, or offers an alternative venue.
   */
  @Patch('venue-bookings/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(ROLES.IQAC)
  reviewBooking(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReviewVenueBookingDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.venuesService.reviewBooking(id, dto, user.sub);
  }
}
