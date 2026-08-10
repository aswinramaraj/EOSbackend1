import { Test, TestingModule } from '@nestjs/testing';
import { RevaluationController } from './revaluation.controller';
import { RevaluationService } from './revaluation.service';

describe('RevaluationController', () => {
  let controller: RevaluationController;
  const revaluationService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    publishRevaluation: jest.fn(),
  };
  const user = { sub: 9, email: 'coe@sece.ac.in', role: 'coe', roleId: 1 };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [RevaluationController],
      providers: [{ provide: RevaluationService, useValue: revaluationService }],
    }).compile();

    controller = module.get<RevaluationController>(RevaluationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates every route to the service', async () => {
    revaluationService.create.mockResolvedValue({ id: 1 });
    revaluationService.findAll.mockResolvedValue([]);
    revaluationService.findOne.mockResolvedValue({});
    revaluationService.update.mockResolvedValue({});
    revaluationService.remove.mockResolvedValue({ id: 1 });
    revaluationService.publishRevaluation.mockResolvedValue({ id: 2 });

    await controller.create({ exam_marks_id: 1, student_id: 5 } as any);
    expect(revaluationService.create).toHaveBeenCalledWith({ exam_marks_id: 1, student_id: 5 });

    await controller.findAll('requested');
    expect(revaluationService.findAll).toHaveBeenCalledWith('requested');

    await controller.findOne('1');
    expect(revaluationService.findOne).toHaveBeenCalledWith(1);

    await controller.update('1', { status: 'revised' } as any);
    expect(revaluationService.update).toHaveBeenCalledWith(1, { status: 'revised' });

    await controller.remove('1');
    expect(revaluationService.remove).toHaveBeenCalledWith(1);

    await controller.publishRevaluation('3', user as any);
    expect(revaluationService.publishRevaluation).toHaveBeenCalledWith(3, 9);
  });
});
