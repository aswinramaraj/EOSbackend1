jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StudentEntrepreneurshipService } from './student-entrepreneurship.service';

describe('StudentEntrepreneurshipService', () => {
  let service: StudentEntrepreneurshipService;
  let prisma: {
    departments: { findUnique: jest.Mock };
    student_entrepreneurship: { findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      departments: { findUnique: jest.fn() },
      student_entrepreneurship: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StudentEntrepreneurshipService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<StudentEntrepreneurshipService>(StudentEntrepreneurshipService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 DEPARTMENT_NOT_FOUND when the department does not exist', async () => {
    prisma.departments.findUnique.mockResolvedValue(null);

    await expect(service.findAllByDepartment(999)).rejects.toMatchObject({
      response: { errorCode: 'DEPARTMENT_NOT_FOUND' },
    });
    expect(prisma.student_entrepreneurship.findMany).not.toHaveBeenCalled();
  });

  it('scopes the query to the given department and maps the student summary', async () => {
    prisma.departments.findUnique.mockResolvedValue({ id: 1 });
    prisma.student_entrepreneurship.findMany.mockResolvedValue([
      {
        id: 20,
        business_name: 'EcoPack',
        business_description: 'Biodegradable packaging',
        sector: 'Sustainability',
        stage: 'idea',
        funding_required: 500000,
        remarks: null,
        created_at: new Date('2026-01-01'),
        students: {
          id: 7,
          student_id_no: '21CSE050',
          soa_applications: { first_name: 'Priya', last_name: null },
          users: { email: 'priya@x.com' },
          classes: { section: 'B' },
        },
      },
    ]);

    const result = await service.findAllByDepartment(1);

    expect(prisma.student_entrepreneurship.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { students: { classes: { department_id: 1 } } },
      }),
    );
    expect(result).toEqual([
      {
        id: 20,
        business_name: 'EcoPack',
        business_description: 'Biodegradable packaging',
        sector: 'Sustainability',
        stage: 'idea',
        funding_required: 500000,
        remarks: null,
        created_at: new Date('2026-01-01'),
        student: { id: 7, student_id_no: '21CSE050', name: 'Priya', section: 'B' },
      },
    ]);
  });
});
