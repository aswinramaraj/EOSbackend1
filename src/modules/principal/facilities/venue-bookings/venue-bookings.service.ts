import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

@Injectable()
export class PrincipalVenueBookingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/principal/facilities/venue-bookings?range=week|month
   *
   * "Faculty in charge" = whoever booked it (`booked_by_user_id`) — there's
   * no separate requester/in-charge distinction in this schema. Not every
   * booker has a `faculty` row (some are Secretary/other staff), so the
   * name falls back to the booking user's email when there's no faculty
   * record — never assumed.
   */
  async list(range: 'week' | 'month') {
    const today = startOfToday();
    const rangeEnd = new Date(today);
    if (range === 'week') rangeEnd.setDate(rangeEnd.getDate() + 7);
    else rangeEnd.setMonth(rangeEnd.getMonth() + 1);

    const bookings = await this.prisma.venue_bookings.findMany({
      where: { from_datetime: { gte: today, lt: rangeEnd } },
      orderBy: { from_datetime: 'asc' },
      select: {
        id: true,
        purpose: true,
        from_datetime: true,
        to_datetime: true,
        status: true,
        venues_venue_bookings_venue_idTovenues: {
          select: { id: true, name: true },
        },
        users_venue_bookings_booked_by_user_idTousers: {
          select: {
            email: true,
            faculty: {
              select: { first_name: true, last_name: true, designation: true },
            },
          },
        },
      },
    });

    return {
      total: bookings.length,
      bookings: bookings.map((b) => {
        const booker = b.users_venue_bookings_booked_by_user_idTousers;
        const facultyInCharge = booker.faculty
          ? `${booker.faculty.first_name} ${booker.faculty.last_name}`
          : booker.email;

        return {
          id: b.id,
          venue: b.venues_venue_bookings_venue_idTovenues,
          date: b.from_datetime.toISOString().slice(0, 10),
          time: `${b.from_datetime.toISOString().slice(11, 16)} - ${b.to_datetime.toISOString().slice(11, 16)}`,
          faculty_in_charge: facultyInCharge,
          purpose: b.purpose,
          status: b.status,
        };
      }),
    };
  }
}
