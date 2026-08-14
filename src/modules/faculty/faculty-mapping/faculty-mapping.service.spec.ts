jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { FacultyMappingService } from './faculty-mapping.service';

describe('FacultyMappingService', () => {
  let service: FacultyMappingService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    subjects: { findUnique: jest.Mock };
    classes: { findUnique: jest.Mock };
    lms_notes: { create: jest.Mock };
    faculty_subject_class_mapping: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    feedback_faculty_responses: { count: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      subjects: { findUnique: jest.fn() },
      classes: { findUnique: jest.fn() },
      lms_notes: { create: jest.fn() },
      faculty_subject_class_mapping: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      feedback_faculty_responses: { count: jest.fn() },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacultyMappingService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FacultyMappingService>(FacultyMappingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('remove', () => {
    const hodUserId = 1;
    const hodFaculty = { id: 1, department_id: 2 };
    const mapping = { id: 42, class_id: 5 };
    const klass = { id: 5, department_id: 2 };

    beforeEach(() => {
      prisma.faculty.findUnique.mockResolvedValue(hodFaculty);
      prisma.faculty_subject_class_mapping.findUnique.mockResolvedValue(
        mapping,
      );
      prisma.classes.findUnique.mockResolvedValue(klass);
    });

    it('rejects deletion when the mapping already has feedback responses', async () => {
      prisma.feedback_faculty_responses.count.mockResolvedValue(3);

      await expect(service.remove(42, hodUserId)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.feedback_faculty_responses.count).toHaveBeenCalledWith({
        where: { mapping_id: 42 },
      });
      expect(
        prisma.faculty_subject_class_mapping.delete,
      ).not.toHaveBeenCalled();
    });

    it('deletes the mapping when it has no feedback responses', async () => {
      prisma.feedback_faculty_responses.count.mockResolvedValue(0);
      prisma.faculty_subject_class_mapping.delete.mockResolvedValue(mapping);

      const result = await service.remove(42, hodUserId);

      expect(prisma.faculty_subject_class_mapping.delete).toHaveBeenCalledWith({
        where: { id: 42 },
      });
      expect(result).toEqual({ id: 42, deleted: true });
    });
  });
});
