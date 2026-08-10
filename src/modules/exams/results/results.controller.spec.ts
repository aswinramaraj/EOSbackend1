import { Test, TestingModule } from '@nestjs/testing';
import { ResultsController } from './results.controller';
import { ResultsService } from './results.service';

describe('ResultsController', () => {
  let controller: ResultsController;
  const resultsService = {
    publish: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const user = { sub: 9, email: 'coe@sece.ac.in', role: 'coe', roleId: 1 };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResultsController],
      providers: [{ provide: ResultsService, useValue: resultsService }],
    }).compile();

    controller = module.get<ResultsController>(ResultsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates publish() to the service with the exam id and the caller resolved from the JWT', async () => {
    resultsService.publish.mockResolvedValue({ id: 1 });

    await controller.publish('5', user as any);

    expect(resultsService.publish).toHaveBeenCalledWith(5, 9);
  });

  it('delegates every other route to the service', async () => {
    resultsService.findAll.mockResolvedValue([]);
    resultsService.findOne.mockResolvedValue({});
    resultsService.update.mockResolvedValue({});
    resultsService.remove.mockResolvedValue({ id: 1 });

    await controller.findAll();
    expect(resultsService.findAll).toHaveBeenCalled();

    await controller.findOne('1');
    expect(resultsService.findOne).toHaveBeenCalledWith(1);

    await controller.update('1', { publication_type: 'revised' } as any);
    expect(resultsService.update).toHaveBeenCalledWith(1, { publication_type: 'revised' });

    await controller.remove('1');
    expect(resultsService.remove).toHaveBeenCalledWith(1);
  });
});
