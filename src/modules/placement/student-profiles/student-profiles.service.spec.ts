import { Test, TestingModule } from '@nestjs/testing';
import { StudentProfilesService } from './student-profiles.service';
import { PrismaService } from '../../../prisma/prisma.service';

// The real PrismaService pulls in the generated Prisma client, which uses
// `import.meta.url` and cannot be parsed by ts-jest's CommonJS transform.
// Mock it out before it's ever required.
jest.mock('../../../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('StudentProfilesService', () => {
  let service: StudentProfilesService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StudentProfilesService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    service = module.get<StudentProfilesService>(StudentProfilesService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
