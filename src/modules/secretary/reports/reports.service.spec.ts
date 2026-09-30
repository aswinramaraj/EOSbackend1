jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { SecretaryReportsService } from './reports.service';

describe('SecretaryReportsService', () => {
  let service: SecretaryReportsService;

  const mockPrismaService = {
    secretary_product_requests: { findMany: jest.fn(), count: jest.fn() },
    service_order_proposals: { findMany: jest.fn(), count: jest.fn() },
    venue_bookings: { findMany: jest.fn(), count: jest.fn() },
    media_requests: { findMany: jest.fn(), count: jest.fn() },
    attendance_records: { findMany: jest.fn() },
    $transaction: jest.fn((ops: unknown[]) => Promise.all(ops)),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrismaService.$transaction.mockImplementation((ops: unknown[]) =>
      Promise.all(ops),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SecretaryReportsService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<SecretaryReportsService>(SecretaryReportsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('builds a product-requests report table scoped to the caller, joining item quantities', async () => {
    mockPrismaService.secretary_product_requests.findMany.mockResolvedValue([
      {
        id: 7,
        title: 'Lab equipment',
        status: 'approved',
        created_at: new Date('2026-07-01'),
        reviewed_at: new Date('2026-07-05'),
        secretary_product_request_items: [
          { product_name: 'Projector', quantity: 2 },
          { product_name: 'Laptop', quantity: 3 },
        ],
      },
    ]);

    const table = await service.productRequests(42);

    expect(mockPrismaService.secretary_product_requests.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ requested_by_user_id: 42 }),
      }),
    );
    expect(table.title).toBe('Product Order Proposals (POP) report');
    expect(table.rows).toEqual([
      {
        id: 7,
        title: 'Lab equipment',
        items: 'Projector x2, Laptop x3',
        status: 'approved',
        submitted: '2026-07-01',
        reviewed: '2026-07-05',
      },
    ]);
  });

  it('sums pending counts and upcoming bookings for the reports summary pills', async () => {
    mockPrismaService.secretary_product_requests.count
      .mockResolvedValueOnce(3) // this month
      .mockResolvedValueOnce(1); // pending
    mockPrismaService.service_order_proposals.count
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);
    mockPrismaService.venue_bookings.count
      .mockResolvedValueOnce(1) // this month
      .mockResolvedValueOnce(1) // pending
      .mockResolvedValueOnce(5); // upcoming
    mockPrismaService.media_requests.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);

    const result = await service.summary(42);

    expect(result).toEqual({
      requests_this_month: 3 + 2 + 1 + 0,
      pending_approvals: 1 + 0 + 1 + 0,
      upcoming_bookings: 5,
    });
  });

  it('builds a service-requests (SOP) report table from service_order_proposals, deriving the HoD/Finance status label', async () => {
    mockPrismaService.service_order_proposals.findMany.mockResolvedValue([
      {
        id: 9,
        status: 'hod_approved',
        finance_reviewed_by: null,
        finance_reviewed_at: null,
        hod_reviewed_at: new Date('2026-08-02'),
        service_orders: null,
        service_indents: {
          title: 'AC repair',
          service_description: 'Two ACs not cooling',
          created_at: new Date('2026-07-27'),
        },
      },
    ]);

    const table = await service.serviceRequests(42);

    expect(mockPrismaService.service_order_proposals.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          service_indents: expect.objectContaining({ requested_by_user_id: 42 }),
        }),
      }),
    );
    expect(table.title).toBe('Service Order Proposals (SOP) report');
    expect(table.rows).toEqual([
      {
        id: 9,
        title: 'AC repair',
        description: 'Two ACs not cooling',
        status: 'pending_finance',
        submitted: '2026-07-27',
        reviewed: '2026-08-02',
      },
    ]);
  });

  it('filters the service-requests report by the derived status, not the raw DB enum', async () => {
    mockPrismaService.service_order_proposals.findMany.mockResolvedValue([
      {
        id: 1,
        status: 'pending',
        finance_reviewed_by: null,
        finance_reviewed_at: null,
        hod_reviewed_at: null,
        service_orders: null,
        service_indents: { title: 'A', service_description: 'a', created_at: new Date('2026-07-01') },
      },
      {
        id: 2,
        status: 'hod_approved',
        finance_reviewed_by: null,
        finance_reviewed_at: null,
        hod_reviewed_at: new Date('2026-07-02'),
        service_orders: null,
        service_indents: { title: 'B', service_description: 'b', created_at: new Date('2026-07-02') },
      },
    ]);

    const table = await service.serviceRequests(42, undefined, undefined, 'pending_hod');

    expect(table.rows).toEqual([
      {
        id: 1,
        title: 'A',
        description: 'a',
        status: 'pending_hod',
        submitted: '2026-07-01',
        reviewed: '',
      },
    ]);
  });

  it('builds an attendance report scoped to records the caller personally marked', async () => {
    mockPrismaService.attendance_records.findMany.mockResolvedValue([
      {
        attendance_date: new Date('2026-08-01'),
        status: 'present',
        classes: { section: 'A', departments: { name: 'AIDS' } },
        subjects: { name: 'Data Structures' },
        students: {
          student_id_no: '21AD001',
          soa_applications: { first_name: 'Ravi', last_name: 'Kumar' },
        },
      },
    ]);

    const table = await service.attendance(42);

    expect(mockPrismaService.attendance_records.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ marked_by_user_id: 42 }),
      }),
    );
    expect(table.rows).toEqual([
      {
        date: '2026-08-01',
        student: 'Ravi Kumar',
        class: 'AIDS A',
        subject: 'Data Structures',
        status: 'present',
      },
    ]);
  });
});
