import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Prisma's default $transaction maxWait (2000ms) is too tight for this
 * project's Supabase pooler round-trip under real-world latency — every
 * batch $transaction here was observed failing at a hard ~2.0-2.3s ceiling
 * ("Unable to start a transaction in the given time"), not intermittently,
 * so this raises the budget rather than papering over a one-off blip.
 */
const TRANSACTION_OPTIONS = { maxWait: 10000, timeout: 15000 };

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function endOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

/**
 * Backs the IQAC admin portal's Dashboard screen (stat cards, today's
 * schedule, live per-venue occupancy). Kept out of venues.service.ts, which
 * already covers venue/booking CRUD + review — this is read-only
 * aggregation over the same two tables, not a new domain concept.
 */
@Injectable()
export class VenueDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /venues/dashboard/summary (IQAC only). The 3 stat cards. */
  async summary() {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const [todayBookings, pendingCount, totalVenues, occupiedNowVenueIds] =
      await this.prisma.$transaction([
        this.prisma.venue_bookings.count({
          where: {
            status: { not: 'rejected' },
            from_datetime: { lte: todayEnd },
            to_datetime: { gte: todayStart },
          },
        }),
        this.prisma.venue_bookings.count({ where: { status: 'pending' } }),
        this.prisma.venues.count(),
        this.prisma.venue_bookings.findMany({
          where: {
            status: { not: 'rejected' },
            from_datetime: { lte: now },
            to_datetime: { gte: now },
          },
          select: { venue_id: true },
          distinct: ['venue_id'],
        }),
      ], TRANSACTION_OPTIONS);

    return {
      today_bookings: todayBookings,
      pending_requests: pendingCount,
      available_venues: totalVenues - occupiedNowVenueIds.length,
      total_venues: totalVenues,
    };
  }

  /**
   * GET /venues/dashboard/live-status (IQAC only). Today's schedule
   * (Completed/In progress/Scheduled, derived from now() vs the booking
   * window) and per-venue live occupancy.
   */
  async liveStatus() {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    const [todayBookings, venues] = await this.prisma.$transaction([
      this.prisma.venue_bookings.findMany({
        where: {
          status: { not: 'rejected' },
          from_datetime: { lte: todayEnd },
          to_datetime: { gte: todayStart },
        },
        orderBy: { from_datetime: 'asc' },
        select: {
          id: true,
          purpose: true,
          from_datetime: true,
          to_datetime: true,
          venue_id: true,
          accommodating_strength: true,
          venues_venue_bookings_venue_idTovenues: { select: { name: true } },
        },
      }),
      this.prisma.venues.findMany({
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      }),
    ], TRANSACTION_OPTIONS);

    const schedule = todayBookings.map((b) => ({
      id: b.id,
      venue_name: b.venues_venue_bookings_venue_idTovenues.name,
      purpose: b.purpose,
      from_datetime: b.from_datetime,
      to_datetime: b.to_datetime,
      accommodating_strength: b.accommodating_strength,
      state:
        b.to_datetime < now
          ? 'completed'
          : b.from_datetime <= now
            ? 'in_progress'
            : 'scheduled',
    }));

    const liveByVenue = new Map(
      todayBookings
        .filter((b) => b.from_datetime <= now && b.to_datetime >= now)
        .map((b) => [b.venue_id, b]),
    );

    const venueStatus = venues.map((v) => {
      const active = liveByVenue.get(v.id);
      return {
        id: v.id,
        name: v.name,
        state: active ? 'in_use' : 'free',
        note: active
          ? `Occupied until ${active.to_datetime.toISOString()}${
              active.accommodating_strength ? ` · ${active.accommodating_strength} seated` : ''
            }`
          : 'Free all day',
      };
    });

    return { schedule, venue_status: venueStatus };
  }
}
