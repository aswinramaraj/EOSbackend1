import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { PrincipalVenueBookingsService } from './venue-bookings.service';

/** GET /api/v1/me/principal/facilities/venue-bookings — Principal only, read-only. */
@Controller('me/principal/facilities/venue-bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.PRINCIPAL)
export class PrincipalVenueBookingsController {
  constructor(
    private readonly venueBookingsService: PrincipalVenueBookingsService,
  ) {}

  @Get()
  list(@Query('range') range?: string) {
    return this.venueBookingsService.list(range === 'month' ? 'month' : 'week');
  }
}
