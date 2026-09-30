jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuditLogService } from 'src/common/audit-log/audit-log.service';
import { ClassesService } from './classes.service';

describe('ClassesService', () => {
  let service: ClassesService;
  let auditLog: { record: jest.Mock };
  let prisma: {
    faculty: { findUnique: jest.Mock };
    classes: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    class_mentors: {
      create: jest.Mock;
      update: jest.Mock;
      findMany: jest.Mock;
      delete: jest.Mock;
    };
    batches: { findUnique: jest.Mock };
    courses: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      classes: {
        findUnique: jest.fn(),
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      class_mentors: {
        create: jest.fn(),
        update: jest.fn(),
        findMany: jest.fn(),
        delete: jest.fn(),
      },
      batches: { findUnique: jest.fn() },
      courses: { findUnique: jest.fn() },
    };
    auditLog = { record: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClassesService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditLogService, useValue: auditLog },
      ],
    }).compile();

    service = module.get<ClassesService>(ClassesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('promoteBatch', () => {
    it('advances every eligible class by one semester and skips the rest, with a reason', async () => {
      prisma.batches.findUnique.mockResolvedValue({ id: 1 });
      prisma.classes.findMany.mockResolvedValue([
        { id: 10, section: 'A', current_semester: 3, batch_id: 1, department_id: 1, course_id: 1, courses: { duration_years: 4 } },
        { id: 11, section: 'B', current_semester: 8, batch_id: 1, department_id: 1, course_id: 1, courses: { duration_years: 4 } },
        { id: 12, section: 'C', current_semester: null, batch_id: 1, department_id: 1, course_id: 1, courses: { duration_years: 4 } },
      ]);
      // update() internals for the one eligible class (id 10).
      prisma.classes.findUnique.mockResolvedValue({
        id: 10,
        batch_id: 1,
        department_id: 1,
        course_id: 1,
        section: 'A',
        current_semester: 3,
      });
      prisma.courses.findUnique.mockResolvedValue({ id: 1, department_id: 1, duration_years: 4 });
      prisma.classes.update.mockResolvedValue({});

      const result = await service.promoteBatch(1, 42);

      expect(result.promoted).toEqual([{ class_id: 10, from_semester: 3, to_semester: 4 }]);
      expect(result.skipped).toEqual([
        { class_id: 11, section: 'B', reason: 'Already at final semester' },
        { class_id: 12, section: 'C', reason: 'No current semester set' },
      ]);
      expect(prisma.classes.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 10 }, data: expect.objectContaining({ current_semester: 4 }) }),
      );
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          entityId: 10,
          action: 'class_updated',
          newValue: expect.objectContaining({ current_semester: 4 }),
          oldValue: expect.objectContaining({ current_semester: 3 }),
        }),
      );
    });

    it('404s when the batch does not exist', async () => {
      prisma.batches.findUnique.mockResolvedValue(null);

      await expect(service.promoteBatch(999, 42)).rejects.toMatchObject({
        response: { errorCode: 'BATCH_NOT_FOUND' },
      });
    });

    it('404s when the batch has no classes yet', async () => {
      prisma.batches.findUnique.mockResolvedValue({ id: 1 });
      prisma.classes.findMany.mockResolvedValue([]);

      await expect(service.promoteBatch(1, 42)).rejects.toMatchObject({
        response: { errorCode: 'NO_CLASSES_FOR_BATCH' },
      });
    });
  });
});
