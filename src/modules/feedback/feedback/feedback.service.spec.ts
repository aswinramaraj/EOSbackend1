import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { PrismaService } from '../../../prisma/prisma.service';
import type { CreateFeedbackFormDto } from './dto/create-feedback-form.dto';
import type { SubmitFeedbackResponsesDto } from './dto/submit-feedback-responses.dto';

// The real PrismaService pulls in the generated Prisma client, which uses
// `import.meta.url` and cannot be parsed by ts-jest's CommonJS transform.
// Mock it out before it's ever required.
jest.mock('../../../prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

const USER = { sub: 7, email: 'a@b.com', role: 'student', roleId: 5 };

interface PrismaMock {
  feedback_forms: {
    create: jest.Mock<unknown, unknown[]>;
    findMany: jest.Mock;
    findUnique: jest.Mock;
    count: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
  };
  feedback_questions: {
    aggregate: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    delete: jest.Mock;
    findFirst: jest.Mock;
  };
  feedback_responses: {
    count: jest.Mock;
    findMany: jest.Mock;
    createMany: jest.Mock;
  };
  feedback_faculty_responses: {
    count: jest.Mock;
    findMany: jest.Mock;
    createMany: jest.Mock<unknown, unknown[]>;
  };
  feedback_rating_scales: { findUnique: jest.Mock };
  classes: { findUnique: jest.Mock; findMany: jest.Mock };
  batches: { findUnique: jest.Mock };
  students: { findUnique: jest.Mock; count: jest.Mock };
  class_subjects: { findMany: jest.Mock };
  faculty_subject_class_mapping: { findMany: jest.Mock };
}

describe('FeedbackService', () => {
  let service: FeedbackService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    prisma = {
      feedback_forms: {
        create: jest.fn<unknown, unknown[]>(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      feedback_questions: {
        aggregate: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findFirst: jest.fn(),
      },
      feedback_responses: {
        count: jest.fn(),
        findMany: jest.fn(),
        createMany: jest.fn(),
      },
      feedback_faculty_responses: {
        count: jest.fn(),
        findMany: jest.fn(),
        createMany: jest.fn<unknown, unknown[]>(),
      },
      feedback_rating_scales: { findUnique: jest.fn() },
      classes: { findUnique: jest.fn(), findMany: jest.fn() },
      batches: { findUnique: jest.fn() },
      students: { findUnique: jest.fn(), count: jest.fn() },
      class_subjects: { findMany: jest.fn() },
      faculty_subject_class_mapping: { findMany: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FeedbackService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<FeedbackService>(FeedbackService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createForm — end_semester form_type', () => {
    it('rejects an end_semester form with no class_id', async () => {
      const dto = {
        title: 'End sem feedback',
        form_type: 'end_semester',
        questions: [{ question_text: 'Q1', question_type: 'rating' }],
      } as unknown as CreateFeedbackFormDto;

      await expect(service.createForm(USER, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('falls back to the default rating scale when omitted, for a form with a rating question', async () => {
      prisma.classes.findUnique.mockResolvedValue({ id: 5 });
      prisma.feedback_rating_scales.findUnique.mockResolvedValue({ id: 1 });
      prisma.feedback_forms.create.mockResolvedValue({ id: 10 });
      const dto = {
        title: 'End sem feedback',
        class_id: 5,
        form_type: 'end_semester',
        questions: [{ question_text: 'Q1', question_type: 'rating' }],
      } as unknown as CreateFeedbackFormDto;

      await service.createForm(USER, dto);

      expect(prisma.feedback_rating_scales.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
      });
      const createArgs = prisma.feedback_forms.create.mock.calls[0][0] as {
        data: { form_type: string; rating_scale_id?: number };
      };
      expect(createArgs.data.form_type).toBe('end_semester');
      expect(createArgs.data.rating_scale_id).toBe(1);
    });

    it('skips the rating-scale check for an all-text end_semester form', async () => {
      prisma.classes.findUnique.mockResolvedValue({ id: 5 });
      prisma.feedback_forms.create.mockResolvedValue({ id: 10 });
      const dto = {
        title: 'End sem feedback',
        class_id: 5,
        form_type: 'end_semester',
        questions: [{ question_text: 'Any comments?', question_type: 'text' }],
      } as unknown as CreateFeedbackFormDto;

      await service.createForm(USER, dto);

      expect(prisma.feedback_rating_scales.findUnique).not.toHaveBeenCalled();
      const createArgs = prisma.feedback_forms.create.mock.calls[0][0] as {
        data: { rating_scale_id?: number };
      };
      expect(createArgs.data.rating_scale_id).toBeUndefined();
    });
  });

  describe('getFormForStudent — end_semester roster resolution', () => {
    const student = { id: 7, class_id: 3, batch_id: 1 };
    const form = {
      id: 20,
      title: 'End sem feedback',
      form_type: 'end_semester',
      class_id: 3,
      batch_id: null,
      feedback_questions: [
        {
          id: 1,
          question_text: 'Pace?',
          sequence_no: 1,
          question_type: 'rating',
        },
      ],
      feedback_rating_scales: {
        id: 1,
        feedback_rating_scale_options: [
          { value: 5, label: 'Excellent' },
          { value: 4, label: 'Very good' },
        ],
      },
    };

    beforeEach(() => {
      prisma.students.findUnique.mockResolvedValue(student);
      prisma.feedback_forms.findUnique.mockResolvedValue(form);
      prisma.classes.findUnique.mockResolvedValue({ current_semester: 5 });
      prisma.feedback_faculty_responses.findMany.mockResolvedValue([]);
    });

    it('dedupes the roster to the most recent mapping per subject', async () => {
      prisma.class_subjects.findMany.mockResolvedValue([
        { subject_id: 1, subjects: { name: 'Maths' } },
      ]);
      // Two mappings for the same subject (a reassignment) — highest id wins.
      // Prisma's orderBy:{id:'desc'} means the newest row arrives first.
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        {
          id: 101,
          subject_id: 1,
          faculty: { id: 9, first_name: 'New', last_name: 'Faculty' },
        },
        {
          id: 100,
          subject_id: 1,
          faculty: { id: 8, first_name: 'Old', last_name: 'Faculty' },
        },
      ]);

      const result = await service.getFormForStudent(USER, 20);

      expect(result.rows).toEqual([
        {
          mapping_id: 101,
          faculty_id: 9,
          faculty_name: 'New Faculty',
          subject_id: 1,
          subject_name: 'Maths',
        },
      ]);
      expect(result.rating_scale).toEqual({
        id: 1,
        options: [
          { value: 5, label: 'Excellent' },
          { value: 4, label: 'Very good' },
        ],
      });
      expect(result.completed).toBe(false);
    });
  });

  describe('listFormsForStudent — end_semester completeness', () => {
    it('marks a matrix form completed on existence of any faculty response, regardless of roster size', async () => {
      prisma.students.findUnique.mockResolvedValue({
        id: 7,
        class_id: 3,
        batch_id: 1,
      });
      prisma.feedback_forms.findMany.mockResolvedValue([
        {
          id: 20,
          title: 'End sem feedback',
          form_type: 'end_semester',
          _count: { feedback_questions: 2 },
        },
      ]);
      prisma.feedback_faculty_responses.count.mockResolvedValue(6);

      const result = await service.listFormsForStudent(USER);

      expect(result).toEqual([
        {
          id: 20,
          title: 'End sem feedback',
          form_type: 'end_semester',
          question_count: 2,
          completed: true,
        },
      ]);
    });
  });

  describe('submitResponses — end_semester matrix branch', () => {
    const student = { id: 7, class_id: 3, batch_id: 1 };
    const form = {
      id: 20,
      class_id: 3,
      batch_id: null,
      form_type: 'end_semester',
      feedback_questions: [
        { id: 1, question_type: 'rating' },
        { id: 2, question_type: 'rating' },
      ],
      feedback_rating_scales: {
        feedback_rating_scale_options: [
          { value: 5 },
          { value: 4 },
          { value: 3 },
        ],
      },
    };
    const mappingA = { id: 100, class_id: 3, faculty_id: 9, subject_id: 1 };
    const mappingB = { id: 101, class_id: 3, faculty_id: 10, subject_id: 2 };

    beforeEach(() => {
      prisma.students.findUnique.mockResolvedValue(student);
      prisma.feedback_forms.findUnique.mockResolvedValue(form);
    });

    it('rejects a resubmission', async () => {
      prisma.feedback_faculty_responses.count.mockResolvedValue(1);
      const dto = {
        responses: [{ question_id: 1, mapping_id: 100, rating_value: 5 }],
      } as unknown as SubmitFeedbackResponsesDto;

      await expect(service.submitResponses(USER, 20, dto)).rejects.toThrow(
        ConflictException,
      );
    });

    it('rejects a mapping_id that belongs to another class', async () => {
      prisma.feedback_faculty_responses.count.mockResolvedValue(0);
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        { id: 999, class_id: 42, faculty_id: 1, subject_id: 1 },
      ]);
      const dto = {
        responses: [{ question_id: 1, mapping_id: 999, rating_value: 5 }],
      } as unknown as SubmitFeedbackResponsesDto;

      await expect(service.submitResponses(USER, 20, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an incomplete rectangle (missing a cell for one of the submitted rows)', async () => {
      prisma.feedback_faculty_responses.count.mockResolvedValue(0);
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        mappingA,
        mappingB,
      ]);
      const dto = {
        responses: [
          { question_id: 1, mapping_id: 100, rating_value: 5 },
          { question_id: 2, mapping_id: 100, rating_value: 5 },
          { question_id: 1, mapping_id: 101, rating_value: 5 },
          // missing question 2 for mapping 101
        ],
      } as unknown as SubmitFeedbackResponsesDto;

      await expect(service.submitResponses(USER, 20, dto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('accepts a full valid submission and denormalizes faculty_id/subject_id per cell', async () => {
      prisma.feedback_faculty_responses.count.mockResolvedValue(0);
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        mappingA,
        mappingB,
      ]);
      prisma.feedback_faculty_responses.createMany.mockResolvedValue({
        count: 4,
      });
      const dto = {
        responses: [
          { question_id: 1, mapping_id: 100, rating_value: 5 },
          { question_id: 2, mapping_id: 100, rating_value: 4 },
          { question_id: 1, mapping_id: 101, rating_value: 3 },
          { question_id: 2, mapping_id: 101, rating_value: 5 },
        ],
      } as unknown as SubmitFeedbackResponsesDto;

      const result = await service.submitResponses(USER, 20, dto);

      const createManyArgs = prisma.feedback_faculty_responses.createMany.mock
        .calls[0][0] as {
        data: {
          question_id: number;
          student_id: number;
          mapping_id: number;
          faculty_id: number;
          subject_id: number;
          rating_value: number;
        }[];
      };
      expect(createManyArgs.data).toHaveLength(4);
      expect(createManyArgs.data).toEqual(
        expect.arrayContaining([
          {
            question_id: 1,
            student_id: 7,
            mapping_id: 100,
            faculty_id: 9,
            subject_id: 1,
            rating_value: 5,
          },
          {
            question_id: 2,
            student_id: 7,
            mapping_id: 101,
            faculty_id: 10,
            subject_id: 2,
            rating_value: 5,
          },
        ]),
      );
      expect(result).toEqual({ form_id: 20, submitted_questions: 4 });
    });
  });

  describe('getResults — end_semester per-row aggregation', () => {
    it('aggregates average_rating and rating_distribution per faculty row', async () => {
      prisma.feedback_forms.findUnique.mockResolvedValue({
        id: 20,
        title: 'End sem feedback',
        form_type: 'end_semester',
        class_id: 3,
        batch_id: null,
        feedback_rating_scales: {
          feedback_rating_scale_options: [
            { value: 5 },
            { value: 4 },
            { value: 3 },
          ],
        },
        feedback_questions: [
          {
            id: 1,
            question_text: 'Pace?',
            sequence_no: 1,
            question_type: 'rating',
            feedback_responses: [],
            feedback_faculty_responses: [
              { mapping_id: 100, rating_value: 5, response_text: null },
              { mapping_id: 100, rating_value: 4, response_text: null },
            ],
          },
        ],
      });
      prisma.classes.findUnique.mockResolvedValue({ current_semester: 5 });
      prisma.class_subjects.findMany.mockResolvedValue([
        { subject_id: 1, subjects: { name: 'Maths' } },
      ]);
      prisma.faculty_subject_class_mapping.findMany.mockResolvedValue([
        {
          id: 100,
          subject_id: 1,
          faculty: { id: 9, first_name: 'A', last_name: 'B' },
        },
      ]);
      prisma.feedback_faculty_responses.findMany.mockResolvedValue([
        { student_id: 7 },
      ]);
      prisma.students.count.mockResolvedValue(30);

      const result = await service.getResults(20);

      expect(result.respondent_count).toBe(1);
      expect(result.target_student_count).toBe(30);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].mapping_id).toBe(100);
      expect(result.rows[0].questions[0]).toEqual(
        expect.objectContaining({
          id: 1,
          response_count: 2,
          average_rating: 4.5,
          rating_distribution: { 5: 1, 4: 1, 3: 0 },
        }),
      );
    });
  });

  describe('deleteForm — combined response guard', () => {
    it('rejects deletion when only feedback_faculty_responses (not feedback_responses) exist', async () => {
      prisma.feedback_forms.findUnique.mockResolvedValue({
        id: 20,
        created_by_user_id: USER.sub,
      });
      prisma.feedback_responses.count.mockResolvedValue(0);
      prisma.feedback_faculty_responses.count.mockResolvedValue(2);

      await expect(service.deleteForm(USER, 20)).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.feedback_forms.delete).not.toHaveBeenCalled();
    });
  });
});
