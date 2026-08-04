import { Test, TestingModule } from '@nestjs/testing';
import { AcademicCalendarController } from './academic-calendar.controller';
import { AcademicCalendarService } from './academic-calendar.service';

describe('AcademicCalendarController', () => {
  let controller: AcademicCalendarController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AcademicCalendarController],
      providers: [AcademicCalendarService],
    }).compile();

    controller = module.get<AcademicCalendarController>(
      AcademicCalendarController,
    );
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
