jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { OutingsService } from './outings.service';

describe('OutingsService', () => {
  let service: OutingsService;
  let prisma: {
    hostel_outings: { findUnique: jest.Mock; update: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      hostel_outings: { findUnique: jest.fn(), update: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [OutingsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<OutingsService>(OutingsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('decide', () => {
    it('throws 404 OUTING_NOT_FOUND when no row exists with this id', async () => {
      prisma.hostel_outings.findUnique.mockResolvedValue(null);

      await expect(
        service.decide(1, { decision: 'approved' }, 99, null),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'OUTING_NOT_FOUND' },
      });
    });

    it('throws 404 OUTING_NOT_FOUND (not 200) when the outing belongs to a different hostel than the caller is scoped to', async () => {
      prisma.hostel_outings.findUnique.mockResolvedValue({
        status: 'pending',
        students: {
          student_hostel_mapping: { hostel_rooms: { hostel_id: 2 } },
        },
      });

      await expect(
        service.decide(1, { decision: 'approved' }, 99, 1),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'OUTING_NOT_FOUND' },
      });
      expect(prisma.hostel_outings.update).not.toHaveBeenCalled();
    });

    it('throws 409 OUTING_ALREADY_DECIDED when not currently pending', async () => {
      prisma.hostel_outings.findUnique.mockResolvedValue({
        status: 'approved',
        students: { student_hostel_mapping: null },
      });

      await expect(
        service.decide(1, { decision: 'approved' }, 99, null),
      ).rejects.toMatchObject({
        status: 409,
        response: { errorCode: 'OUTING_ALREADY_DECIDED' },
      });
    });

    it('allows the decision when the outing belongs to the caller\'s own hostel', async () => {
      prisma.hostel_outings.findUnique.mockResolvedValue({
        status: 'pending',
        students: {
          student_hostel_mapping: { hostel_rooms: { hostel_id: 1 } },
        },
      });
      prisma.hostel_outings.update.mockResolvedValue({
        id: 1,
        status: 'approved',
        students: {
          id: 5,
          student_id_no: '23EC056',
          roll_no: '23EC056',
          soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
          users: { email: 'arjun.kumar@example.com' },
          student_hostel_mapping: { hostel_rooms: { room_number: 'A101', hostels: { id: 1, name: 'Block A', code: 'A' } } },
        },
        users: null,
        from_date: new Date('2026-08-20T00:00:00.000Z'),
        to_date: new Date('2026-08-21T00:00:00.000Z'),
        start_time: new Date('2026-08-20T08:00:00.000Z'),
        return_time: null,
        reason: 'Family function',
        created_at: new Date('2026-08-19T00:00:00.000Z'),
      });

      await service.decide(1, { decision: 'approved' }, 99, 1);

      expect(prisma.hostel_outings.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 1 },
          data: { status: 'approved', approved_by_warden_user_id: 99 },
        }),
      );
    });

    it('allows the decision with no hostel scope (e.g. admin)', async () => {
      prisma.hostel_outings.findUnique.mockResolvedValue({
        status: 'pending',
        students: {
          student_hostel_mapping: { hostel_rooms: { hostel_id: 2 } },
        },
      });
      prisma.hostel_outings.update.mockResolvedValue({
        id: 1,
        status: 'rejected',
        students: {
          id: 5,
          student_id_no: '23EC056',
          roll_no: '23EC056',
          soa_applications: null,
          users: { email: 'arjun.kumar@example.com' },
          student_hostel_mapping: null,
        },
        users: null,
        from_date: new Date('2026-08-20T00:00:00.000Z'),
        to_date: new Date('2026-08-21T00:00:00.000Z'),
        start_time: new Date('2026-08-20T08:00:00.000Z'),
        return_time: null,
        reason: 'Family function',
        created_at: new Date('2026-08-19T00:00:00.000Z'),
      });

      await service.decide(1, { decision: 'rejected' }, 99, null);

      expect(prisma.hostel_outings.update).toHaveBeenCalled();
    });
  });
});
