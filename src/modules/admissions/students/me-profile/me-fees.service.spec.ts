import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeFeesService } from './me-fees.service';

describe('MeFeesService', () => {
  let service: MeFeesService;
  let prisma: {
    students: { findUnique: jest.Mock };
    student_fee_demand_mapping: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      student_fee_demand_mapping: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [MeFeesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<MeFeesService>(MeFeesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(service.getMyFees(999)).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  it('scopes the query to the resolved student_id', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.student_fee_demand_mapping.findMany.mockResolvedValue([]);

    await service.getMyFees(1);

    const [findManyArgs] = prisma.student_fee_demand_mapping.findMany.mock
      .calls[0] as [{ where: Record<string, unknown> }];
    expect(findManyArgs.where).toMatchObject({ student_id: 42 });
  });

  it('computes paid/due/status: fully paid when payments cover the total', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.student_fee_demand_mapping.findMany.mockResolvedValue([
      {
        id: 1,
        academic_year: '2025-2026',
        semester: 5,
        total_amount: 50000,
        fee_structures: { name: 'Semester 5 Tuition' },
        fee_payments: [
          {
            id: 10,
            amount_paid: 50000,
            payment_date: new Date('2026-07-01T00:00:00.000Z'),
            payment_mode: 'upi',
            receipt_no: 'RCT-001',
            is_partial: false,
          },
        ],
      },
    ]);

    const result = await service.getMyFees(1);

    expect(result.demands).toEqual([
      {
        id: 1,
        fee_structure_name: 'Semester 5 Tuition',
        academic_year: '2025-2026',
        semester: 5,
        total: 50000,
        paid: 50000,
        due: 0,
        status: 'paid',
      },
    ]);
    expect(result.payments).toEqual([
      {
        id: 10,
        demand_id: 1,
        fee_structure_name: 'Semester 5 Tuition',
        amount_paid: 50000,
        payment_date: '2026-07-01',
        payment_mode: 'upi',
        receipt_no: 'RCT-001',
        is_partial: false,
      },
    ]);
  });

  it('computes status: partial when some but not all is paid', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.student_fee_demand_mapping.findMany.mockResolvedValue([
      {
        id: 2,
        academic_year: '2025-2026',
        semester: 5,
        total_amount: 50000,
        fee_structures: { name: 'Semester 5 Tuition' },
        fee_payments: [
          {
            id: 11,
            amount_paid: 20000,
            payment_date: new Date('2026-07-01T00:00:00.000Z'),
            payment_mode: 'cash',
            receipt_no: 'RCT-002',
            is_partial: true,
          },
        ],
      },
    ]);

    const result = await service.getMyFees(1);

    expect(result.demands[0]).toMatchObject({
      total: 50000,
      paid: 20000,
      due: 30000,
      status: 'partial',
    });
  });

  it('computes status: pending when nothing has been paid yet', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.student_fee_demand_mapping.findMany.mockResolvedValue([
      {
        id: 3,
        academic_year: '2025-2026',
        semester: 6,
        total_amount: 40000,
        fee_structures: { name: 'Semester 6 Tuition' },
        fee_payments: [],
      },
    ]);

    const result = await service.getMyFees(1);

    expect(result.demands[0]).toMatchObject({
      total: 40000,
      paid: 0,
      due: 40000,
      status: 'pending',
    });
    expect(result.payments).toEqual([]);
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.student_fee_demand_mapping.findMany.mockRejectedValue(
      new Error('connection lost'),
    );

    await expect(service.getMyFees(1)).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
