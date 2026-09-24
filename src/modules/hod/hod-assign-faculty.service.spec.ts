jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { ClassesService } from 'src/modules/academic-structure/classes/classes.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { HodAssignFacultyService } from './hod-assign-faculty.service';

const user: JwtPayload = {
  sub: 100,
  email: 'hod@eos.test',
  role: 'hod',
  roleId: 3,
};

describe('HodAssignFacultyService', () => {
  let service: HodAssignFacultyService;
  let prisma: {
    faculty: { findUnique: jest.Mock; findMany: jest.Mock };
    classes: { findUnique: jest.Mock; findMany: jest.Mock };
    class_subjects: { findMany: jest.Mock };
    faculty_subject_class_mapping: { findMany: jest.Mock };
  };
  let classes: { findMentor: jest.Mock; assignMentor: jest.Mock };

  beforeEach(async () => {
    prisma = {
      faculty: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
      },
      classes: { findUnique: jest.fn(), findMany: jest.fn() },
      class_subjects: { findMany: jest.fn() },
      faculty_subject_class_mapping: { findMany: jest.fn() },
    };
    classes = { findMentor: jest.fn(), assignMentor: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HodAssignFacultyService,
        { provide: PrismaService, useValue: prisma },
        { provide: ClassesService, useValue: classes },
      ],
    }).compile();

    service = module.get<HodAssignFacultyService>(HodAssignFacultyService);
  });

  describe('setClassMentor', () => {
    it("appoints the mentor via ClassesService, scoped to the HoD's own department", async () => {
      prisma.faculty.findUnique
        .mockResolvedValueOnce({ department_id: 3 }) // resolveDepartmentId (caller)
        .mockResolvedValueOnce({ department_id: 3 }); // target faculty's own department
      prisma.classes.findUnique.mockResolvedValue({ department_id: 3 });
      classes.assignMentor.mockResolvedValue({
        faculty: { id: 60, first_name: 'Radha', last_name: 'Kumar' },
      });

      const result = await service.setClassMentor(user, 1121, 60);

      expect(classes.assignMentor).toHaveBeenCalledWith(
        1121,
        expect.objectContaining({ faculty_id: 60 }),
        100,
      );
      expect(result).toEqual({ faculty_id: 60, name: 'Radha Kumar' });
    });

    it('rejects a class outside the calling HoD department', async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({ department_id: 3 });
      prisma.classes.findUnique.mockResolvedValue({ department_id: 9 });

      await expect(
        service.setClassMentor(user, 1121, 60),
      ).rejects.toMatchObject({
        response: { errorCode: 'CLASS_NOT_FOUND' },
      });
      expect(classes.assignMentor).not.toHaveBeenCalled();
    });

    it('rejects a candidate faculty from a different department', async () => {
      prisma.faculty.findUnique
        .mockResolvedValueOnce({ department_id: 3 })
        .mockResolvedValueOnce({ department_id: 9 });
      prisma.classes.findUnique.mockResolvedValue({ department_id: 3 });

      await expect(
        service.setClassMentor(user, 1121, 60),
      ).rejects.toMatchObject({
        response: { errorCode: 'FACULTY_OUT_OF_DEPARTMENT' },
      });
      expect(classes.assignMentor).not.toHaveBeenCalled();
    });
  });

  describe('getOverview current_mentor', () => {
    it("includes the selected class's current mentor when one is assigned", async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({ department_id: 3 });
      prisma.classes.findMany.mockResolvedValue([
        { id: 1121, section: 'A', current_semester: 7 },
      ]);
      // faculty_options lookup reuses the same mock — findMany is called
      // twice (classes, then faculty) but only classes.findMany matters here
      prisma.class_subjects.findMany.mockResolvedValue([]);
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([]);
      classes.findMentor.mockResolvedValue([
        { faculty: { id: 60, first_name: 'Radha', last_name: 'Kumar' } },
      ]);

      const overview = await service.getOverview(user, 1121);

      expect(classes.findMentor).toHaveBeenCalledWith(
        1121,
        expect.objectContaining({
          academic_year: expect.stringMatching(/^\d{4}-\d{2}$/) as string,
        }),
      );
      expect(overview.current_mentor).toEqual({
        faculty_id: 60,
        name: 'Radha Kumar',
      });
    });

    it('reports no mentor as null, not a fabricated value', async () => {
      prisma.faculty.findUnique.mockResolvedValueOnce({ department_id: 3 });
      prisma.classes.findMany.mockResolvedValue([
        { id: 1121, section: 'A', current_semester: 7 },
      ]);
      prisma.class_subjects.findMany.mockResolvedValue([]);
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([]);
      classes.findMentor.mockResolvedValue([]);

      const overview = await service.getOverview(user, 1121);

      expect(overview.current_mentor).toBeNull();
    });
  });
});
