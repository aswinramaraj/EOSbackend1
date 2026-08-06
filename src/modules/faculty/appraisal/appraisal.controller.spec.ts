jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/modules/storage/storage.service';
import { AppraisalController } from './appraisal.controller';
import { AppraisalService } from './appraisal.service';

describe('AppraisalController', () => {
  let controller: AppraisalController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AppraisalController],
      providers: [
        AppraisalService,
        {
          provide: PrismaService,
          useValue: {
            faculty: { findUnique: jest.fn() },
            appraisal_criteria: { findMany: jest.fn() },
            appraisal_divisions: { findUnique: jest.fn() },
            appraisal_requests: {
              create: jest.fn(),
              findMany: jest.fn(),
              count: jest.fn(),
              findFirst: jest.fn(),
              findUnique: jest.fn(),
              findUniqueOrThrow: jest.fn(),
              update: jest.fn(),
              delete: jest.fn(),
            },
            appraisal_entries: {
              createMany: jest.fn(),
              findMany: jest.fn(),
              update: jest.fn(),
            },
            appraisal_attachments: {
              createMany: jest.fn(),
              findUnique: jest.fn(),
              delete: jest.fn(),
            },
            $transaction: jest.fn(),
          },
        },
        {
          provide: StorageService,
          useValue: { upload: jest.fn(), remove: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<AppraisalController>(AppraisalController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
