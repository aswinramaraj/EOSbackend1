import { Test, TestingModule } from '@nestjs/testing';
import { DrivesController } from './drives.controller';
import { DrivesService } from './drives.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { CompaniesService } from '../companies/companies.service';
import { NotificationsService } from '../../notifications/notifications/notifications.service';

// The real PrismaService pulls in the generated Prisma client, which uses
// `import.meta.url` and cannot be parsed by ts-jest's CommonJS transform.
// Mock it out before it's ever required.
jest.mock('../../../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('DrivesController', () => {
  let controller: DrivesController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DrivesController],
      providers: [
        DrivesService,
        { provide: PrismaService, useValue: {} },
        { provide: CompaniesService, useValue: {} },
        { provide: NotificationsService, useValue: { notify: jest.fn() } },
      ],
    }).compile();

    controller = module.get<DrivesController>(DrivesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
