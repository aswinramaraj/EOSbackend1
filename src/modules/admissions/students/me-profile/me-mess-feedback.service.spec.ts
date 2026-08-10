import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { MeMessFeedbackService } from './me-mess-feedback.service';

describe('MeMessFeedbackService', () => {
  let service: MeMessFeedbackService;
  let prisma: {
    students: { findUnique: jest.Mock };
    student_hostel_mapping: { findUnique: jest.Mock };
    hostel_mess_feedback: { create: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      students: { findUnique: jest.fn() },
      student_hostel_mapping: { findUnique: jest.fn() },
      hostel_mess_feedback: { create: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeMessFeedbackService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<MeMessFeedbackService>(MeMessFeedbackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('throws 404 STUDENT_NOT_FOUND when the JWT user has no linked student record', async () => {
    prisma.students.findUnique.mockResolvedValue(null);

    await expect(service.createFeedback(999, { rating: 4 })).rejects.toMatchObject({
      status: 404,
      response: { errorCode: 'STUDENT_NOT_FOUND' },
    });
  });

  it('throws 422 NOT_A_HOSTELLER when the caller has no student_hostel_mapping row', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.student_hostel_mapping.findUnique.mockResolvedValue(null);

    await expect(service.createFeedback(1, { rating: 4 })).rejects.toMatchObject({
      status: 422,
      response: { errorCode: 'NOT_A_HOSTELLER' },
    });
    expect(prisma.hostel_mess_feedback.create).not.toHaveBeenCalled();
  });

  it('resolves hostel_id server-side and creates the feedback row', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.student_hostel_mapping.findUnique.mockResolvedValue({
      hostel_rooms: { hostel_id: 7 },
    });
    prisma.hostel_mess_feedback.create.mockResolvedValue({
      id: 1,
      rating: 4,
      comment: 'Lunch: tasted good today',
      created_at: new Date('2026-08-05T00:00:00.000Z'),
    });

    const result = await service.createFeedback(1, {
      rating: 4,
      comment: 'Lunch: tasted good today',
    });

    expect(prisma.hostel_mess_feedback.create).toHaveBeenCalledWith({
      data: { student_id: 42, hostel_id: 7, rating: 4, comment: 'Lunch: tasted good today' },
    });
    expect(result).toEqual({
      id: 1,
      rating: 4,
      comment: 'Lunch: tasted good today',
      created_at: '2026-08-05T00:00:00.000Z',
    });
  });

  it('wraps a DB failure as 500 INTERNAL_ERROR', async () => {
    prisma.students.findUnique.mockResolvedValue({ id: 42 });
    prisma.student_hostel_mapping.findUnique.mockResolvedValue({
      hostel_rooms: { hostel_id: 7 },
    });
    prisma.hostel_mess_feedback.create.mockRejectedValue(new Error('connection lost'));

    await expect(service.createFeedback(1, { rating: 4 })).rejects.toMatchObject({
      status: 500,
      response: { errorCode: 'INTERNAL_ERROR' },
    });
  });
});
