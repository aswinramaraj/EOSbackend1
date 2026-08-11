import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { BonafideReasonsService } from './bonafide-reasons.service';

describe('BonafideReasonsService', () => {
  let service: BonafideReasonsService;
  let prisma: { bonafide_reasons: { findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { bonafide_reasons: { findMany: jest.fn() } };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BonafideReasonsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<BonafideReasonsService>(BonafideReasonsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('returns the reasons list ordered by reason_text', async () => {
    prisma.bonafide_reasons.findMany.mockResolvedValue([
      { id: 1, reason_text: 'Bank loan' },
      { id: 2, reason_text: 'Passport application' },
    ]);

    const result = await service.findAll();

    expect(result).toEqual([
      { id: 1, reason_text: 'Bank loan' },
      { id: 2, reason_text: 'Passport application' },
    ]);
    expect(prisma.bonafide_reasons.findMany).toHaveBeenCalledWith({
      orderBy: { reason_text: 'asc' },
    });
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.bonafide_reasons.findMany.mockRejectedValue(new Error('connection lost'));

    await expect(service.findAll()).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
