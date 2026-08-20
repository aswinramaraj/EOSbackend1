jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { GateLogService } from './gate-log.service';

describe('GateLogService', () => {
  let service: GateLogService;
  let prisma: {
    students: { findUnique: jest.Mock };
    hostel_outings: { findUnique: jest.Mock };
    hostel_in_out_ledger: { create: jest.Mock };
  };

  function loggedStudent(overrides: Record<string, unknown> = {}) {
    return {
      id: 5,
      student_id_no: '23EC056',
      roll_no: '23EC056',
      soa_applications: { first_name: 'Arjun', last_name: 'Kumar' },
      users: { email: 'arjun.kumar@example.com' },
      student_hostel_mapping: {
        hostel_rooms: {
          room_number: 'A101',
          hostels: { id: 1, name: 'Block A', code: 'A' },
        },
      },
      ...overrides,
    };
  }

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      hostel_outings: { findUnique: jest.fn() },
      hostel_in_out_ledger: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [GateLogService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<GateLogService>(GateLogService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('throws 404 STUDENT_NOT_FOUND when the student does not exist', async () => {
      prisma.students.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ student_id: 1, entry_type: 'out' }, 99, null),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'STUDENT_NOT_FOUND' },
      });
    });

    it('throws 404 STUDENT_NOT_FOUND (not success) when the student belongs to a different hostel than the caller is scoped to', async () => {
      prisma.students.findUnique.mockResolvedValue({
        id: 5,
        student_hostel_mapping: {
          hostel_rooms: { hostel_id: 2 },
        },
      });

      await expect(
        service.create({ student_id: 5, entry_type: 'out' }, 99, 1),
      ).rejects.toMatchObject({
        status: 404,
        response: { errorCode: 'STUDENT_NOT_FOUND' },
      });
      expect(prisma.hostel_in_out_ledger.create).not.toHaveBeenCalled();
    });

    it('allows the entry when the student belongs to the caller\'s own hostel', async () => {
      prisma.students.findUnique.mockResolvedValue({
        id: 5,
        student_hostel_mapping: {
          hostel_rooms: { hostel_id: 1 },
        },
      });
      prisma.hostel_in_out_ledger.create.mockResolvedValue({
        id: 1,
        students: loggedStudent(),
        users: { email: 'warden@example.com' },
        entry_type: 'out',
        outing_id: null,
        recorded_at: new Date('2026-08-20T09:00:00.000Z'),
      });

      await service.create({ student_id: 5, entry_type: 'out' }, 99, 1);

      expect(prisma.hostel_in_out_ledger.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            student_id: 5,
            entry_type: 'out',
            outing_id: undefined,
            recorded_by_user_id: 99,
          },
        }),
      );
    });

    it('allows the entry with no hostel scope (e.g. admin)', async () => {
      prisma.students.findUnique.mockResolvedValue({
        id: 5,
        student_hostel_mapping: {
          hostel_rooms: { hostel_id: 2 },
        },
      });
      prisma.hostel_in_out_ledger.create.mockResolvedValue({
        id: 1,
        students: loggedStudent(),
        users: { email: 'admin@example.com' },
        entry_type: 'in',
        outing_id: null,
        recorded_at: new Date('2026-08-20T09:00:00.000Z'),
      });

      await service.create({ student_id: 5, entry_type: 'in' }, 99, null);

      expect(prisma.hostel_in_out_ledger.create).toHaveBeenCalled();
    });
  });
});
