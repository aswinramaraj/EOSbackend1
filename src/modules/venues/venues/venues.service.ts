import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { NotificationsService } from '../../notifications/notifications/notifications.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { CreateVenueBookingDto } from './dto/create-venue-booking.dto';
import { ListVenueQueryDto } from './dto/list-venue-query.dto';
import { ReviewVenueBookingDto } from './dto/review-venue-booking.dto';
import { ListVenueBookingQueryDto } from './dto/list-venue-booking-query.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const VENUE_AVAILABILITY_BOOKING_SELECT = {
  purpose: true,
  from_datetime: true,
  to_datetime: true,
  accommodating_strength: true,
  users_venue_bookings_booked_by_user_idTousers: {
    select: {
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  },
} as const;

interface VenueAvailabilityBookerRow {
  email: string;
  faculty: { first_name: string; last_name: string } | null;
  non_teaching_staff: { first_name: string; last_name: string }[];
}

interface VenueAvailabilityBookingRow {
  purpose: string;
  from_datetime: Date;
  to_datetime: Date;
  accommodating_strength: number | null;
  users_venue_bookings_booked_by_user_idTousers: VenueAvailabilityBookerRow;
}

interface VenueAvailabilityRow {
  id: number;
  name: string;
  location: string | null;
  capacity: number | null;
  venue_bookings_venue_bookings_venue_idTovenues: VenueAvailabilityBookingRow[];
}

/**
 * No generic "display name" column exists on `users` — resolved via whichever
 * profile relation the booker actually has: faculty first, then
 * non_teaching_staff (HoD/Faculty/IQAC/Placement staff who aren't faculty),
 * falling back to their email when neither profile exists.
 */
function resolveBookerName(user: VenueAvailabilityBookerRow): string {
  if (user.faculty) {
    return `${user.faculty.first_name} ${user.faculty.last_name}`;
  }
  if (user.non_teaching_staff[0]) {
    const staff = user.non_teaching_staff[0];
    return `${staff.first_name} ${staff.last_name}`;
  }
  return user.email;
}

function toVenueAvailability(venue: VenueAvailabilityRow) {
  const [booking] = venue.venue_bookings_venue_bookings_venue_idTovenues;
  return {
    id: venue.id,
    name: venue.name,
    location: venue.location,
    capacity: venue.capacity,
    is_available: !booking,
    booking: booking
      ? {
          purpose: booking.purpose,
          booked_by: resolveBookerName(
            booking.users_venue_bookings_booked_by_user_idTousers,
          ),
          accommodating_strength: booking.accommodating_strength,
          from_datetime: booking.from_datetime,
          to_datetime: booking.to_datetime,
        }
      : null,
  };
}

const VENUE_BOOKING_SELECT = {
  id: true,
  venue_id: true,
  purpose: true,
  from_datetime: true,
  to_datetime: true,
  accommodating_strength: true,
  status: true,
  reviewed_by_user_id: true,
  alternative_venue_id: true,
  created_at: true,
  venues_venue_bookings_venue_idTovenues: {
    select: { id: true, name: true, location: true, capacity: true },
  },
  users_venue_bookings_booked_by_user_idTousers: {
    select: { id: true, email: true },
  },
} as const;

@Injectable()
export class VenuesService {
  private readonly logger = new Logger(VenuesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** POST /venues (Admin only). */
  async create(createVenueDto: CreateVenueDto) {
    const venue = await this.prisma.venues.create({
      data: {
        name: createVenueDto.name,
        location: createVenueDto.location,
        capacity: createVenueDto.capacity,
      },
    });

    this.logger.log(`Venue created: id=${venue.id}`);
    return venue;
  }

  /**
   * GET /venues?from=...&to=...&search=...&page=...&limit=... — availability
   * check (any authenticated user; no department/ownership filtering).
   * `search` optionally filters by venue name (contains, case-insensitive).
   *
   * `venues` has no `created_at` column, so results are ordered by `id`
   * (same fallback used by lesson_plans, which has the same limitation).
   * A venue is "available" when it has no *non-rejected* booking whose
   * window overlaps [from, to); `venue_booking_status_enum` has no
   * "cancelled" value (only pending/approved/rejected/alternative_offered),
   * so "rejected" is the only status excluded here.
   */
  async findAll(query: ListVenueQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);

    if (from >= to) {
      throw new BadRequestException('from must be before to');
    }

    const where = query.search
      ? { name: { contains: query.search, mode: 'insensitive' as const } }
      : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.venues.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { id: 'asc' },
        select: {
          id: true,
          name: true,
          location: true,
          capacity: true,
          venue_bookings_venue_bookings_venue_idTovenues: {
            where: {
              status: { not: 'rejected' },
              from_datetime: { lt: to },
              to_datetime: { gt: from },
            },
            orderBy: { created_at: 'desc' },
            take: 1,
            select: VENUE_AVAILABILITY_BOOKING_SELECT,
          },
        },
      }),
      this.prisma.venues.count({ where }),
    ]);

    return paginate(rows.map(toVenueAvailability), total, query);
  }

  /** GET /venues/:id (any authenticated user). Static venue details only. */
  async findOne(id: number) {
    const venue = await this.prisma.venues.findUnique({ where: { id } });
    if (!venue) {
      throw new NotFoundException('Venue not found');
    }
    return venue;
  }

  /** PATCH /venues/:id (Admin only). */
  async update(id: number, updateVenueDto: UpdateVenueDto) {
    if (!updateVenueDto || Object.keys(updateVenueDto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    try {
      return await this.prisma.venues.update({
        where: { id },
        data: updateVenueDto,
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException('Venue not found');
      }
      throw err;
    }
  }

  /**
   * DELETE /venues/:id (Admin only). Hard delete — venues has no soft-delete
   * column. grn/hall_plans/venue_bookings all reference venues with
   * onDelete: NoAction, so deleting a venue still in use fails at the DB
   * level; translated here to a friendly 409 instead of a raw FK error.
   */
  async remove(id: number) {
    try {
      await this.prisma.venues.delete({ where: { id } });
    } catch (err: unknown) {
      const code = prismaErrorCode(err);
      if (code === 'P2025') {
        throw new NotFoundException('Venue not found');
      }
      if (code === 'P2003' || code === 'P2014') {
        throw new ConflictException({
          message:
            'Cannot delete a venue that has existing bookings, hall plans, or GRN issuances',
          errorCode: 'VENUE_IN_USE',
        });
      }
      throw err;
    }

    this.logger.log(`Venue deleted: id=${id}`);
    return { id, deleted: true };
  }

  /**
   * POST /venue-bookings (HoD / Faculty / Placement / IQAC / Secretary).
   *
   * workflow.md: venue reservations are reviewed by IQAC afterwards, which
   * either approves, offers an alternative venue, or denies for no
   * availability — conflict resolution is IQAC's job, not this endpoint's.
   * So overlapping bookings for the same venue/time window are NOT rejected
   * here; every request is simply inserted as 'pending' for IQAC to review.
   */
  async createBooking(dto: CreateVenueBookingDto, userId: number) {
    const venue = await this.prisma.venues.findUnique({
      where: { id: dto.venue_id },
    });
    if (!venue) {
      throw new NotFoundException({
        message: 'Venue not found',
        errorCode: 'VENUE_NOT_FOUND',
      });
    }

    const fromDatetime = new Date(dto.from_datetime);
    const toDatetime = new Date(dto.to_datetime);

    // A precise instant comparison, not a calendar-date-only one: a booking
    // for today at a time that has already passed is genuinely in the past
    // and must be rejected, while a booking later today (or any future day)
    // must be allowed. `fromDatetime`/`now` are both absolute instants
    // (parsed from/constructed with full timezone information), so `<` here
    // is timezone-safe regardless of which zone the server or the caller is
    // in — the comparison never needs to reason about "local" at all.
    if (fromDatetime < new Date()) {
      throw new UnprocessableEntityException({
        message: 'from_datetime must not be in the past',
        errorCode: 'INVALID_TIME_RANGE',
      });
    }

    if (fromDatetime >= toDatetime) {
      throw new UnprocessableEntityException({
        message: 'from_datetime must be before to_datetime',
        errorCode: 'INVALID_TIME_RANGE',
      });
    }

    const booking = await this.prisma.venue_bookings.create({
      data: {
        venue_id: dto.venue_id,
        booked_by_user_id: userId,
        purpose: dto.purpose,
        from_datetime: fromDatetime,
        to_datetime: toDatetime,
        accommodating_strength: dto.accommodating_strength,
        status: 'pending',
      },
      select: VENUE_BOOKING_SELECT,
    });

    this.logger.log(
      `Venue booking requested: id=${booking.id} venue=${dto.venue_id} by user=${userId}`,
    );
    return booking;
  }

  /**
   * GET /venue-bookings (IQAC sees all; every other allowed role is
   * force-scoped to their own submissions — mirrors Faculty Leaves/Appraisal/
   * HR Payroll's own-only pattern for the non-reviewer roles).
   */
  async findAllBookings(
    query: ListVenueBookingQueryDto,
    currentUser: JwtPayload,
  ) {
    const where: Record<string, unknown> = { status: query.status };

    if (currentUser.role !== ROLES.IQAC) {
      where.booked_by_user_id = currentUser.sub;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.venue_bookings.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: VENUE_BOOKING_SELECT,
      }),
      this.prisma.venue_bookings.count({ where }),
    ]);

    return paginate(rows, total, query);
  }

  /** GET /venue-bookings/:id (IQAC sees any; everyone else only their own). */
  async findOneBooking(id: number, currentUser: JwtPayload) {
    const booking = await this.prisma.venue_bookings.findUnique({
      where: { id },
      select: VENUE_BOOKING_SELECT,
    });
    if (!booking) {
      throw new NotFoundException('Venue booking not found');
    }

    if (
      currentUser.role !== ROLES.IQAC &&
      booking.users_venue_bookings_booked_by_user_idTousers.id !==
        currentUser.sub
    ) {
      throw new ForbiddenException('You may only view your own venue bookings');
    }

    return booking;
  }

  /**
   * PATCH /venue-bookings/:id (IQAC only).
   *
   * workflow.md (IQAC): reviews a reservation and either approves it, offers
   * an alternative venue, or denies it for no availability — the three
   * decisions map directly onto venue_booking_status_enum's non-pending
   * values. Only a still-'pending' booking can be reviewed.
   */
  async reviewBooking(id: number, dto: ReviewVenueBookingDto, userId: number) {
    const booking = await this.prisma.venue_bookings.findUnique({
      where: { id },
    });
    if (!booking) {
      throw new NotFoundException({
        message: 'Venue booking not found',
        errorCode: 'BOOKING_NOT_FOUND',
      });
    }

    if (booking.status !== 'pending') {
      throw new ConflictException({
        message: 'This venue booking has already been reviewed',
        errorCode: 'ALREADY_REVIEWED',
      });
    }

    if (dto.decision === 'alternative_offered') {
      if (!dto.alternative_venue_id) {
        throw new BadRequestException(
          'alternative_venue_id is required when offering an alternative venue',
        );
      }
      if (dto.alternative_venue_id === booking.venue_id) {
        throw new BadRequestException(
          'alternative_venue_id must differ from the originally requested venue',
        );
      }
      const alternativeVenue = await this.prisma.venues.findUnique({
        where: { id: dto.alternative_venue_id },
      });
      if (!alternativeVenue) {
        throw new NotFoundException({
          message: 'Alternative venue not found',
          errorCode: 'VENUE_NOT_FOUND',
        });
      }
    }

    const updated = await this.prisma.venue_bookings.update({
      where: { id },
      data: {
        status: dto.decision,
        reviewed_by_user_id: userId,
        ...(dto.decision === 'alternative_offered' && {
          alternative_venue_id: dto.alternative_venue_id,
        }),
      },
      select: VENUE_BOOKING_SELECT,
    });

    this.logger.log(
      `Venue booking ${id} reviewed: decision=${dto.decision} by user=${userId}`,
    );

    const venueName = updated.venues_venue_bookings_venue_idTovenues.name;
    const decisionMessage =
      dto.decision === 'alternative_offered'
        ? `An alternative venue has been offered for your booking of "${venueName}".`
        : `Your booking for "${venueName}" has been ${dto.decision}.`;
    await this.notifications.create({
      user_id: booking.booked_by_user_id,
      title: `Venue booking ${dto.decision}`,
      message: decisionMessage,
    });

    return updated;
  }
}
