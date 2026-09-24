jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { MeTimetableRequestsController } from './me-timetable-requests.controller';
import { TimetablePeriodRequestsService } from './timetable-period-requests.service';

describe('MeTimetableRequestsController', () => {
  let controller: MeTimetableRequestsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeTimetableRequestsController],
      providers: [
        {
          provide: TimetablePeriodRequestsService,
          useValue: {
            createTakeover: jest.fn(),
            createSwap: jest.fn(),
            listMine: jest.fn(),
            listColleaguesForDate: jest.fn(),
            respond: jest.fn(),
            cancel: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<MeTimetableRequestsController>(
      MeTimetableRequestsController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
