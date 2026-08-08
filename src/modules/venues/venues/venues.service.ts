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
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { CreateVenueDto } from './dto/create-venue.dto';
import { UpdateVenueDto } from './dto/update-venue.dto';
import { CreateVenueBookingDto } from './dto/create-venue-booking.dto';
import { ListVenueQueryDto } from './dto/list-venue-query.dto';
import { ReviewVenueBookingDto } from './dto/review-venue-booking.dto';
import { ReallocateVenueBookingDto } from './dto/reallocate-venue-booking.dto';
import { ListVenueBookingQueryDto } from './dto/list-venue-booking-query.dto';

/**
 * Prisma's default $transaction maxWait (2000ms) is too tight for this
 * project's Supabase pooler round-trip under real-world latency — every
 * batch $transaction here was observed failing at a hard ~2.0-2.3s ceiling
 * ("Unable to start a transaction in the given time"), not intermittently,
 * so this raises the budget rather than papering over a one-off blip.
 */
const TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 15000 };

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
  description: true,
  requirements: true,
  from_datetime: true,
  to_datetime: true,
  accommodating_strength: true,
  status: true,
  reviewed_by_user_id: true,
  alternative_venue_id: true,
  admin_remarks: true,
  reviewed_at: true,
  created_at: true,
  venues_venue_bookings_venue_idTovenues: {
    select: { id: true, name: true, location: true, capacity: true },
  },
  venues_venue_bookings_alternative_venue_idTovenues: {
    select: { id: true, name: true, location: true, capacity: true },
  },
  users_venue_bookings_booked_by_user_idTousers: {
    select: {
      id: true,
      email: true,
      phone: true,
      faculty: { select: { first_name: true, last_name: true, departments: { select: { name: true } } } },
      non_teaching_staff: {
        select: { first_name: true, last_name: true, departments: { select: { name: true } } },
      },
    },
  },
} as const;

interface VenueBookingBookerRow {
  id: number;
  email: string;
  phone: string | null;
  faculty: { first_name: string; last_name: string; departments: { name: string } } | null;
  non_teaching_staff: {
    first_name: string;
    last_name: string | null;
    departments: { name: string } | null;
  }[];
}

interface VenueBookingRow {
  id: number;
  venue_id: number;
  purpose: string;
  description: string | null;
  requirements: string[];
  from_datetime: Date;
  to_datetime: Date;
  accommodating_strength: number | null;
  status: string;
  reviewed_by_user_id: number | null;
  alternative_venue_id: number | null;
  admin_remarks: string | null;
  reviewed_at: Date | null;
  created_at: Date;
  venues_venue_bookings_venue_idTovenues: {
    id: number;
    name: string;
    location: string | null;
    capacity: number | null;
  };
  venues_venue_bookings_alternative_venue_idTovenues: {
    id: number;
    name: string;
    location: string | null;
    capacity: number | null;
  } | null;
  users_venue_bookings_booked_by_user_idTousers: VenueBookingBookerRow;
}

/** Same fallback chain as resolveBookerName - faculty first, then non_teaching_staff, then email. */
function resolveBooker(user: VenueBookingBookerRow) {
  const profile = user.faculty ?? user.non_teaching_staff[0] ?? null;
  return {
    name: profile ? `${profile.first_name} ${profile.last_name ?? ''}`.trim() : user.email,
    department_name: profile?.departments?.name ?? null,
    email: user.email,
    phone: user.phone,
  };
}

function toBookingResponse(booking: VenueBookingRow) {
  return {
    id: booking.id,
    venue_id: booking.venue_id,
    venue: booking.venues_venue_bookings_venue_idTovenues,
    purpose: booking.purpose,
    description: booking.description,
    requirements: booking.requirements,
    from_datetime: booking.from_datetime,
    to_datetime: booking.to_datetime,
    accommodating_strength: booking.accommodating_strength,
    status: booking.status,
    admin_remarks: booking.admin_remarks,
    reviewed_at: booking.reviewed_at,
    alternative_venue: booking.venues_venue_bookings_alternative_venue_idTovenues,
    booked_by: resolveBooker(booking.users_venue_bookings_booked_by_user_idTousers),
    created_at: booking.created_at,
  };
}

@Injectable()
export class VenuesService {
  private readonly logger = new Logger(VenuesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
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
   * GET /venues?from=...&to=...&page=...&limit=... — availability check
   * (any authenticated user; no department/ownership filtering).
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

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.venues.findMany({
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
      this.prisma.venues.count(),
    ], TRANSACTION_OPTIONS);

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
   * POST /venue-bookings (HoD / Faculty / Placement / IQAC).
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

    if (fromDatetime <= new Date()) {
      throw new UnprocessableEntityException({
        message: 'from_datetime must be in the future',
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
        description: dto.description,
        requirements: dto.requirements ?? [],
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
    return toBookingResponse(booking);
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

    if (query.date) {
      const dayStart = new Date(query.date);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(query.date);
      dayEnd.setHours(23, 59, 59, 999);
      where.from_datetime = { lte: dayEnd };
      where.to_datetime = { gte: dayStart };
    }

    const bookerConditions: Record<string, unknown>[] = [];
    if (query.search) {
      bookerConditions.push({
        OR: [
          { email: { contains: query.search, mode: 'insensitive' } },
          { faculty: { first_name: { contains: query.search, mode: 'insensitive' } } },
          { faculty: { last_name: { contains: query.search, mode: 'insensitive' } } },
        ],
      });
    }
    if (query.department_id) {
      bookerConditions.push({
        OR: [
          { faculty: { department_id: query.department_id } },
          { non_teaching_staff: { some: { department_id: query.department_id } } },
        ],
      });
    }
    if (bookerConditions.length > 0) {
      where.users_venue_bookings_booked_by_user_idTousers = { AND: bookerConditions };
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
    ], TRANSACTION_OPTIONS);

    return paginate(rows.map(toBookingResponse), total, query);
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

    return toBookingResponse(booking);
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
        reviewed_at: new Date(),
        admin_remarks: dto.admin_remarks,
        ...(dto.decision === 'alternative_offered' && {
          alternative_venue_id: dto.alternative_venue_id,
        }),
      },
      select: VENUE_BOOKING_SELECT,
    });

    this.logger.log(
      `Venue booking ${id} reviewed: decision=${dto.decision} by user=${userId}`,
    );
    await this.notifyBooker(updated, dto.decision);
    return toBookingResponse(updated);
  }

  /**
   * PATCH /venue-bookings/:id/reallocate (IQAC only).
   *
   * Distinct from reviewBooking's 'alternative_offered' decision (which only
   * records a suggestion): this reassigns the booking to a different venue
   * and marks it 'approved' outright, matching the admin portal's
   * Reallocate drawer ("pick a venue" -> booked). Usable on a 'pending' OR
   * already-'rejected' booking - never on one already 'approved' or
   * 'alternative_offered', which have already been decided.
   */
  async reallocateBooking(
    id: number,
    dto: ReallocateVenueBookingDto,
    userId: number,
  ) {
    const booking = await this.prisma.venue_bookings.findUnique({
      where: { id },
    });
    if (!booking) {
      throw new NotFoundException({
        message: 'Venue booking not found',
        errorCode: 'BOOKING_NOT_FOUND',
      });
    }

    if (booking.status !== 'pending' && booking.status !== 'rejected') {
      throw new ConflictException({
        message: 'Only a pending or rejected booking can be reallocated',
        errorCode: 'ALREADY_REVIEWED',
      });
    }

    if (dto.venue_id === booking.venue_id) {
      throw new BadRequestException(
        'venue_id must differ from the originally requested venue',
      );
    }

    const venue = await this.prisma.venues.findUnique({
      where: { id: dto.venue_id },
    });
    if (!venue) {
      throw new NotFoundException({
        message: 'Venue not found',
        errorCode: 'VENUE_NOT_FOUND',
      });
    }

    const updated = await this.prisma.venue_bookings.update({
      where: { id },
      data: {
        venue_id: dto.venue_id,
        status: 'approved',
        reviewed_by_user_id: userId,
        reviewed_at: new Date(),
        admin_remarks: dto.admin_remarks,
        alternative_venue_id: null,
      },
      select: VENUE_BOOKING_SELECT,
    });

    this.logger.log(
      `Venue booking ${id} reallocated to venue=${dto.venue_id} by user=${userId}`,
    );
    await this.notifyBooker(updated, 'approved');
    return toBookingResponse(updated);
  }

  /** Best-effort notification - a delivery failure must never fail the review/reallocate request itself. */
  private async notifyBooker(booking: VenueBookingRow, decision: string) {
    const messages: Record<string, string> = {
      approved: `Your venue booking for "${booking.purpose}" has been approved.`,
      rejected: `Your venue booking for "${booking.purpose}" has been rejected.`,
      alternative_offered: `An alternative venue has been offered for your booking "${booking.purpose}".`,
    };

    try {
      await this.notificationsService.create({
        user_id: booking.users_venue_bookings_booked_by_user_idTousers.id,
        title: 'Venue booking update',
        message: messages[decision] ?? `Your venue booking "${booking.purpose}" was updated.`,
      });
    } catch (err) {
      this.logger.warn(
        `Failed to notify booker for venue booking ${booking.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
