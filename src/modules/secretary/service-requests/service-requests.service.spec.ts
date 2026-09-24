jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from '../../notifications/notifications/notifications.service';
import { ServiceRequestsService } from './service-requests.service';

describe('ServiceRequestsService', () => {
  let service: ServiceRequestsService;
  let mockNotificationsService: { notify: jest.Mock };

  beforeEach(async () => {
    mockNotificationsService = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ServiceRequestsService,
        {
          provide: PrismaService,
          useValue: {
            secretary_service_requests: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              findUnique: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            secretary_service_request_items: {
              deleteMany: jest.fn(),
            },
            $transaction: jest.fn(),
            $executeRaw: jest.fn(),
          },
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = module.get<ServiceRequestsService>(ServiceRequestsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('notifies the requester when a pending request is reviewed', async () => {
    const prisma = (service as unknown as { prisma: any }).prisma;
    prisma.secretary_service_requests.findUnique.mockResolvedValue({
      id: 5,
      title: 'AC servicing',
      status: 'pending',
      requested_by_user_id: 99,
    });
    prisma.secretary_service_requests.update.mockResolvedValue({
      id: 5,
      title: 'AC servicing',
      justification: null,
      status: 'rejected',
      created_at: new Date(),
      updated_at: new Date(),
      reviewed_at: new Date(),
      secretary_service_request_items: [],
      users_secretary_service_requests_requested_by_user_idTousers: {
        id: 99,
        email: 'req@example.com',
        faculty: null,
        non_teaching_staff: [],
      },
      users_secretary_service_requests_reviewed_by_user_idTousers: {
        id: 1,
        email: 'admin@example.com',
        faculty: null,
        non_teaching_staff: [],
      },
    });

    await service.review(5, { decision: 'rejected' }, 1);

    expect(mockNotificationsService.notify).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 99 }),
    );
  });

  it('persists the reject reason to secretary_service_requests.remarks', async () => {
    const prisma = (service as unknown as { prisma: any }).prisma;
    prisma.secretary_service_requests.findUnique.mockResolvedValue({
      id: 5,
      title: 'AC servicing',
      status: 'pending',
      requested_by_user_id: 99,
    });
    prisma.secretary_service_requests.update.mockResolvedValue({
      id: 5,
      title: 'AC servicing',
      justification: null,
      status: 'rejected',
      created_at: new Date(),
      updated_at: new Date(),
      reviewed_at: new Date(),
      secretary_service_request_items: [],
      users_secretary_service_requests_requested_by_user_idTousers: {
        id: 99,
        email: 'req@example.com',
        faculty: null,
        non_teaching_staff: [],
      },
      users_secretary_service_requests_reviewed_by_user_idTousers: {
        id: 1,
        email: 'admin@example.com',
        faculty: null,
        non_teaching_staff: [],
      },
    });

    await service.review(
      5,
      { decision: 'rejected', remarks: 'Budget not approved this quarter' },
      1,
    );

    expect(prisma.$executeRaw).toHaveBeenCalled();
    const [strings, ...values] = prisma.$executeRaw.mock.calls[0];
    expect(strings.join('?')).toContain(
      'UPDATE secretary_service_requests SET remarks',
    );
    expect(values).toContain('Budget not approved this quarter');
  });

  it('does not call $executeRaw when no remarks are given', async () => {
    const prisma = (service as unknown as { prisma: any }).prisma;
    prisma.secretary_service_requests.findUnique.mockResolvedValue({
      id: 5,
      title: 'AC servicing',
      status: 'pending',
      requested_by_user_id: 99,
    });
    prisma.secretary_service_requests.update.mockResolvedValue({
      id: 5,
      title: 'AC servicing',
      justification: null,
      status: 'approved',
      created_at: new Date(),
      updated_at: new Date(),
      reviewed_at: new Date(),
      secretary_service_request_items: [],
      users_secretary_service_requests_requested_by_user_idTousers: {
        id: 99,
        email: 'req@example.com',
        faculty: null,
        non_teaching_staff: [],
      },
      users_secretary_service_requests_reviewed_by_user_idTousers: null,
    });

    await service.review(5, { decision: 'approved' }, 1);

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
});
