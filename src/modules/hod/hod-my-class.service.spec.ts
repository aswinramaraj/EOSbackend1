jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { HodMyClassService } from './hod-my-class.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

describe('HodMyClassService', () => {
  let service: HodMyClassService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    faculty_subject_class_mapping: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    timetable_slots: { groupBy: jest.Mock };
    assignments: { groupBy: jest.Mock };
    lms_notes: { groupBy: jest.Mock };
  };
  const user: JwtPayload = {
    sub: 1,
    email: 'hod@eos.test',
    role: 'hod',
  } as JwtPayload;

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      faculty_subject_class_mapping: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      timetable_slots: { groupBy: jest.fn() },
      assignments: { groupBy: jest.fn() },
      lms_notes: { groupBy: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HodMyClassService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<HodMyClassService>(HodMyClassService);
  });

  describe('getCurrentSemester', () => {
    it('throws 404 when the JWT user has no linked faculty record', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(service.getCurrentSemester(user)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('returns an empty subject list when the HOD has no handled-class mappings', async () => {
      prisma.faculty.findUnique.mockResolvedValue({
        id: 5,
        first_name: 'R',
        last_name: 'Subha',
      });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue(null);

      const result = await service.getCurrentSemester(user);

      expect(result).toEqual({ academic_year: null, subjects: [] });
      expect(prisma.timetable_slots.groupBy).not.toHaveBeenCalled();
    });

    it('batches hours/tasks/materials via 3 groupBy calls (not one query per mapping) and maps counts by class+subject', async () => {
      prisma.faculty.findUnique.mockResolvedValue({
        id: 5,
        first_name: 'R',
        last_name: 'Subha',
      });
      prisma.faculty_subject_class_mapping.findFirst.mockResolvedValue({
        academic_year: '2025-2026',
      });
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        {
          class_id: 20,
          subject_id: 10,
          academic_year: '2025-2026',
          classes: {
            section: 'A',
            current_semester: 7,
            departments: { name: 'CSE' },
          },
          subjects: { name: 'Cryptography', subject_code: 'CS8792' },
        },
        {
          class_id: 21,
          subject_id: 11,
          academic_year: '2025-2026',
          classes: {
            section: 'B',
            current_semester: 5,
            departments: { name: 'CSE' },
          },
          subjects: { name: 'Networks', subject_code: 'CS8551' },
        },
      ]);
      prisma.timetable_slots.groupBy.mockResolvedValue([
        { class_id: 20, subject_id: 10, _count: { _all: 3 } },
      ]);
      prisma.assignments.groupBy.mockResolvedValue([
        { class_id: 20, subject_id: 10, _count: { _all: 4 } },
        { class_id: 21, subject_id: 11, _count: { _all: 1 } },
      ]);
      prisma.lms_notes.groupBy.mockResolvedValue([
        { class_id: 21, subject_id: 11, _count: { _all: 6 } },
      ]);

      const result = await service.getCurrentSemester(user);

      // Exactly 3 DB round trips for counts, regardless of mapping count.
      expect(prisma.timetable_slots.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.assignments.groupBy).toHaveBeenCalledTimes(1);
      expect(prisma.lms_notes.groupBy).toHaveBeenCalledTimes(1);

      expect(result.academic_year).toBe('2025-2026');
      expect(result.subjects).toEqual([
        expect.objectContaining({
          class_id: 20,
          subject_id: 10,
          hours_per_week: 3,
          tasks_count: 4,
          materials_count: 0,
        }),
        expect.objectContaining({
          class_id: 21,
          subject_id: 11,
          hours_per_week: 0,
          tasks_count: 1,
          materials_count: 6,
        }),
      ]);
    });
  });
});
