import { Test, TestingModule } from '@nestjs/testing';
import { AchievementsController } from './achievements.controller';
import { AchievementsService } from './achievements.service';

describe('AchievementsController', () => {
  let controller: AchievementsController;
  const service = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    addMedia: jest.fn(),
    removeMedia: jest.fn(),
    addComment: jest.fn(),
    removeComment: jest.fn(),
  };
  const user = { sub: 1, email: 's@eos.test', role: 'secretary', roleId: 1 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AchievementsController],
      providers: [{ provide: AchievementsService, useValue: service }],
    }).compile();

    controller = module.get<AchievementsController>(AchievementsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates every route to the service with the caller resolved from the JWT', () => {
    controller.create(user, { title: 'x' } as any);
    expect(service.create).toHaveBeenCalledWith(user, { title: 'x' });

    controller.removeMedia(user, 5, 9);
    expect(service.removeMedia).toHaveBeenCalledWith(user, 5, 9);

    controller.removeComment(user, 5, 9);
    expect(service.removeComment).toHaveBeenCalledWith(user, 5, 9);
  });
});
