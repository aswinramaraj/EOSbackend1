jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { EResourcesController } from './e-resources.controller';
import { EResourcesService } from './e-resources.service';

describe('EResourcesController', () => {
  let controller: EResourcesController;

  const mockEResourcesService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    searchFuzzy: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EResourcesController],
      providers: [
        {
          provide: EResourcesService,
          useValue: mockEResourcesService,
        },
      ],
    }).compile();

    controller = module.get<EResourcesController>(EResourcesController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('findAll should call service.findAll with the query dto and return its result', async () => {
    const query = { q: 'ieee', page: 1, page_size: 20 };
    const expected = { page: 1, page_size: 20, total: 0, data: [] };
    mockEResourcesService.findAll.mockResolvedValue(expected);

    const result = await controller.findAll(query);

    expect(mockEResourcesService.findAll).toHaveBeenCalledWith(query);
    expect(result).toBe(expected);
  });

  it('findOne should call service.findOne with the parsed id and return its result', async () => {
    const expected = { id: 1, title: 'A Resource' };
    mockEResourcesService.findOne.mockResolvedValue(expected);

    const result = await controller.findOne(1);

    expect(mockEResourcesService.findOne).toHaveBeenCalledWith(1);
    expect(result).toBe(expected);
  });

  it('create should call service.create with the dto, the caller id, and return its result', async () => {
    const dto = {
      title: 'New Resource',
      url: 'https://example.com',
      category_id: 1,
    };
    const user = {
      sub: 1,
      email: 'library@eos.test',
      role: 'library',
      roleId: 8,
    };
    const expected = { id: 1, ...dto };
    mockEResourcesService.create.mockResolvedValue(expected);

    const result = await controller.create(dto, user);

    expect(mockEResourcesService.create).toHaveBeenCalledWith(dto, user.sub);
    expect(result).toBe(expected);
  });

  it('update should call service.update with the parsed id and dto and return its result', async () => {
    const dto = { title: 'Updated title' };
    const expected = { id: 1, title: 'Updated title' };
    mockEResourcesService.update.mockResolvedValue(expected);

    const result = await controller.update(1, dto);

    expect(mockEResourcesService.update).toHaveBeenCalledWith(1, dto);
    expect(result).toBe(expected);
  });

  it('remove should call service.remove with the parsed id and return its result', async () => {
    const expected = { message: 'E-resource deleted successfully.' };
    mockEResourcesService.remove.mockResolvedValue(expected);

    const result = await controller.remove(1);

    expect(mockEResourcesService.remove).toHaveBeenCalledWith(1);
    expect(result).toBe(expected);
  });

  it('searchFuzzy should call service.searchFuzzy with the query and limit and return its result', async () => {
    const query = { q: 'ieee', limit: 20 };
    const expected = [
      { id: 1, title: 'IEEE Xplore Digital Library', similarity: 0.6 },
    ];
    mockEResourcesService.searchFuzzy.mockResolvedValue(expected);

    const result = await controller.searchFuzzy(query);

    expect(mockEResourcesService.searchFuzzy).toHaveBeenCalledWith('ieee', 20);
    expect(result).toBe(expected);
  });
});
