jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StudentHigherEducationService } from './student-higher-education.service';

describe('StudentHigherEducationService', () => {
  let service: StudentHigherEducationService;
  let prisma: {
    departments: { findUnique: jest.Mock };
    student_higher_education: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      departments: { findUnique: jest.fn() },
      student_higher_education: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StudentHigherEducationService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<StudentHigherEducationService>(StudentHigherEducationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 DEPARTMENT_NOT_FOUND when the department does not exist', async () => {
    prisma.departments.findUnique.mockResolvedValue(null);

    await expect(service.findAllByDepartment(999)).rejects.toMatchObject({
      response: { errorCode: 'DEPARTMENT_NOT_FOUND' },
    });
    expect(prisma.student_higher_education.findMany).not.toHaveBeenCalled();
  });

  it('scopes the query to the given department and maps the student summary', async () => {
    prisma.departments.findUnique.mockResolvedValue({ id: 1 });
    prisma.student_higher_education.findMany.mockResolvedValue([
      {
        id: 10,
        preferred_course: 'MS Computer Science',
        preferred_country: 'USA',
        preferred_university: 'Stanford',
        remarks: null,
        created_at: new Date('2026-01-01'),
        students: {
          id: 5,
          student_id_no: '21CSE042',
          soa_applications: { first_name: 'Arun', last_name: 'Kumar' },
          users: { email: 'arun@x.com' },
          classes: { section: 'A' },
        },
      },
    ]);

    const result = await service.findAllByDepartment(1);

    expect(prisma.student_higher_education.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { students: { classes: { department_id: 1 } } },
      }),
    );
    expect(result).toEqual([
      {
        id: 10,
        preferred_course: 'MS Computer Science',
        preferred_country: 'USA',
        preferred_university: 'Stanford',
        remarks: null,
        created_at: new Date('2026-01-01'),
        student: { id: 5, student_id_no: '21CSE042', name: 'Arun Kumar', section: 'A' },
      },
    ]);
  });

  it('falls back to email when the student has no soa_applications row', async () => {
    prisma.departments.findUnique.mockResolvedValue({ id: 1 });
    prisma.student_higher_education.findMany.mockResolvedValue([
      {
        id: 11,
        preferred_course: 'MBA',
        preferred_country: 'UK',
        preferred_university: null,
        remarks: null,
        created_at: new Date('2026-01-02'),
        students: {
          id: 6,
          student_id_no: '21CSE043',
          soa_applications: null,
          users: { email: 'noapp@x.com' },
          classes: null,
        },
      },
    ]);

    const result = await service.findAllByDepartment(1);

    expect(result[0].student.name).toBe('noapp@x.com');
    expect(result[0].student.section).toBeNull();
  });
});
