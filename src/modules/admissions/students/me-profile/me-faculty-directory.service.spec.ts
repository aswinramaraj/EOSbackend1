import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeFacultyDirectoryService } from './me-faculty-directory.service';

describe('MeFacultyDirectoryService', () => {
  let service: MeFacultyDirectoryService;
  let prisma: { faculty: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { faculty: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeFacultyDirectoryService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeFacultyDirectoryService>(MeFacultyDirectoryService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('scopes the query to active faculty, ordered by first then last name', async () => {
    prisma.faculty.findMany.mockResolvedValue([]);

    await service.getFacultyDirectory();

    const [args] = prisma.faculty.findMany.mock.calls[0] as [
      { where: Record<string, unknown>; orderBy: unknown },
    ];
    expect(args.where).toEqual({ status: 'active' });
    expect(args.orderBy).toEqual([{ first_name: 'asc' }, { last_name: 'asc' }]);
  });

  it('maps each row to id/name/department_name', async () => {
    prisma.faculty.findMany.mockResolvedValue([
      {
        id: 3,
        first_name: 'Kavitha',
        last_name: 'R',
        departments_faculty_department_idTodepartments: {
          name: 'Computer Science and Engineering',
        },
      },
      {
        id: 5,
        first_name: 'Naveen',
        last_name: null,
        departments_faculty_department_idTodepartments: {
          name: 'Mechanical Engineering',
        },
      },
    ]);

    const result = await service.getFacultyDirectory();

    expect(result).toEqual([
      { id: 3, name: 'Kavitha R', department_name: 'Computer Science and Engineering' },
      { id: 5, name: 'Naveen', department_name: 'Mechanical Engineering' },
    ]);
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.faculty.findMany.mockRejectedValue(new Error('connection lost'));

    await expect(service.getFacultyDirectory()).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
