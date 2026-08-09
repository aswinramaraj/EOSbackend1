jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { PersonalCalendarService } from './personal-calendar.service';

describe('PersonalCalendarService', () => {
  let service: PersonalCalendarService;
  let prisma: {
    personal_calendar_entries: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      personal_calendar_entries: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [PersonalCalendarService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<PersonalCalendarService>(PersonalCalendarService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('creates an entry scoped to the caller user_id', async () => {
      prisma.personal_calendar_entries.create.mockResolvedValue({ id: 1 });

      await service.create(100, {
        entry_date: '2026-08-14',
        title: 'Governing council meeting',
      } as any);

      expect(prisma.personal_calendar_entries.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          user_id: 100,
          title: 'Governing council meeting',
        }),
      });
    });
  });

  describe('findAll', () => {
    it('scopes the list to the caller user_id', async () => {
      prisma.personal_calendar_entries.findMany.mockResolvedValue([]);

      await service.findAll(100, {});

      expect(prisma.personal_calendar_entries.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 100 } }),
      );
    });

    it('applies from/to as an entry_date range', async () => {
      prisma.personal_calendar_entries.findMany.mockResolvedValue([]);

      await service.findAll(100, { from: '2026-08-01', to: '2026-08-31' });

      expect(prisma.personal_calendar_entries.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            user_id: 100,
            entry_date: {
              gte: new Date('2026-08-01T00:00:00.000Z'),
              lte: new Date('2026-08-31T00:00:00.000Z'),
            },
          },
        }),
      );
    });
  });

  describe('ownership', () => {
    it('throws 404 when the entry does not exist', async () => {
      prisma.personal_calendar_entries.findUnique.mockResolvedValue(null);

      await expect(service.update(100, 999, {} as any)).rejects.toMatchObject({
        response: { errorCode: 'NOT_FOUND' },
      });
    });

    it('throws 403 NOT_OWNER when the entry belongs to someone else', async () => {
      prisma.personal_calendar_entries.findUnique.mockResolvedValue({ id: 5, user_id: 200 });

      await expect(service.remove(100, 5)).rejects.toMatchObject({
        response: { errorCode: 'NOT_OWNER' },
      });
      expect(prisma.personal_calendar_entries.delete).not.toHaveBeenCalled();
    });

    it('updates when the entry belongs to the caller', async () => {
      prisma.personal_calendar_entries.findUnique.mockResolvedValue({ id: 5, user_id: 100 });
      prisma.personal_calendar_entries.update.mockResolvedValue({ id: 5 });

      await service.update(100, 5, { title: 'Updated title' } as any);

      expect(prisma.personal_calendar_entries.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 5 } }),
      );
    });

    it('deletes when the entry belongs to the caller', async () => {
      prisma.personal_calendar_entries.findUnique.mockResolvedValue({ id: 5, user_id: 100 });
      prisma.personal_calendar_entries.delete.mockResolvedValue({ id: 5 });

      await service.remove(100, 5);

      expect(prisma.personal_calendar_entries.delete).toHaveBeenCalledWith({ where: { id: 5 } });
    });
  });
});
