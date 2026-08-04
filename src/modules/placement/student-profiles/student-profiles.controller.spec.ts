import { Test, TestingModule } from '@nestjs/testing';
import { StudentProfilesController } from './student-profiles.controller';
import { StudentProfilesService } from './student-profiles.service';
import { PrismaService } from '../../../prisma/prisma.service';

// The real PrismaService pulls in the generated Prisma client, which uses
// `import.meta.url` and cannot be parsed by ts-jest's CommonJS transform.
// Mock it out before it's ever required.
jest.mock('../../../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('StudentProfilesController', () => {
  let controller: StudentProfilesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [StudentProfilesController],
      providers: [
        StudentProfilesService,
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    controller = module.get<StudentProfilesController>(
      StudentProfilesController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
