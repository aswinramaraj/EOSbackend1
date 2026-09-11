jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { VenuesService } from './venues.service';

describe('VenuesService', () => {
  let service: VenuesService;
  let mockNotificationsService: { create: jest.Mock };

  beforeEach(async () => {
    mockNotificationsService = { create: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VenuesService,
        {
          provide: PrismaService,
          useValue: {
            venues: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
              count: jest.fn(),
            },
            venue_bookings: {
              create: jest.fn(),
              findUnique: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
              count: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = module.get<VenuesService>(VenuesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  function startOfToday(): Date {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }

  it('allows a booking later today, after the current time', async () => {
    const prisma = (service as unknown as { prisma: any }).prisma;
    prisma.venues.findUnique.mockResolvedValue({
      id: 1,
      name: 'Hall',
      capacity: 100,
    });
    prisma.venue_bookings.create.mockResolvedValue({ id: 1 });

    const from = new Date(Date.now() + 60 * 60 * 1000); // one hour from now — still "today" in almost all cases
    const to = new Date(from.getTime() + 60 * 60 * 1000);

    await expect(
      service.createBooking(
        {
          venue_id: 1,
          purpose: 'Test',
          from_datetime: from.toISOString(),
          to_datetime: to.toISOString(),
        },
        42,
      ),
    ).resolves.toBeDefined();
    expect(prisma.venue_bookings.create).toHaveBeenCalled();
  });

  it('rejects a booking for today at a time that has already passed', async () => {
    const prisma = (service as unknown as { prisma: any }).prisma;
    prisma.venues.findUnique.mockResolvedValue({
      id: 1,
      name: 'Hall',
      capacity: 100,
    });

    const from = new Date(startOfToday());
    from.setSeconds(1); // start of today — always already in the past by the time this runs
    const to = new Date(from);
    to.setHours(to.getHours() + 1);

    await expect(
      service.createBooking(
        {
          venue_id: 1,
          purpose: 'Test',
          from_datetime: from.toISOString(),
          to_datetime: to.toISOString(),
        },
        42,
      ),
    ).rejects.toThrow('from_datetime must not be in the past');
    expect(prisma.venue_bookings.create).not.toHaveBeenCalled();
  });

  it('allows a booking for a future date', async () => {
    const prisma = (service as unknown as { prisma: any }).prisma;
    prisma.venues.findUnique.mockResolvedValue({
      id: 1,
      name: 'Hall',
      capacity: 100,
    });
    prisma.venue_bookings.create.mockResolvedValue({ id: 2 });

    const from = new Date(startOfToday());
    from.setDate(from.getDate() + 7);
    from.setHours(10, 0, 0, 0);
    const to = new Date(from);
    to.setHours(11, 0, 0, 0);

    await expect(
      service.createBooking(
        {
          venue_id: 1,
          purpose: 'Test',
          from_datetime: from.toISOString(),
          to_datetime: to.toISOString(),
        },
        42,
      ),
    ).resolves.toBeDefined();
  });

  it('rejects a booking dated before today', async () => {
    const prisma = (service as unknown as { prisma: any }).prisma;
    prisma.venues.findUnique.mockResolvedValue({
      id: 1,
      name: 'Hall',
      capacity: 100,
    });

    const from = new Date(startOfToday());
    from.setDate(from.getDate() - 1);
    const to = new Date(from);
    to.setHours(to.getHours() + 1);

    await expect(
      service.createBooking(
        {
          venue_id: 1,
          purpose: 'Test',
          from_datetime: from.toISOString(),
          to_datetime: to.toISOString(),
        },
        42,
      ),
    ).rejects.toThrow('from_datetime must not be in the past');
    expect(prisma.venue_bookings.create).not.toHaveBeenCalled();
  });

  it('notifies the booker when a pending booking is reviewed', async () => {
    const prisma = (service as unknown as { prisma: any }).prisma;
    prisma.venue_bookings.findUnique.mockResolvedValue({
      id: 8,
      venue_id: 1,
      booked_by_user_id: 77,
      status: 'pending',
    });
    prisma.venue_bookings.update.mockResolvedValue({
      id: 8,
      venue_id: 1,
      purpose: 'Symposium',
      from_datetime: new Date(),
      to_datetime: new Date(),
      accommodating_strength: 100,
      status: 'approved',
      reviewed_by_user_id: 1,
      alternative_venue_id: null,
      created_at: new Date(),
      venues_venue_bookings_venue_idTovenues: {
        id: 1,
        name: 'Main Auditorium',
        location: 'Block A',
        capacity: 500,
      },
      users_venue_bookings_booked_by_user_idTousers: {
        id: 77,
        email: 'sec@example.com',
      },
    });

    await service.reviewBooking(8, { decision: 'approved' }, 1);

    expect(mockNotificationsService.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 77 }),
    );
  });
});
