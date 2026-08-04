// results.service.ts
import {
  Injectable,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateResultDto } from './dto/update-result.dto';

@Injectable()
export class ResultsService {
  private readonly logger = new Logger(ResultsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async publish(examId: number, publishedByUserId: number) {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });

    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: examId },
      select: { id: true },
    });

    if (mappings.length === 0) {
      throw new UnprocessableEntityException({
        message: 'Marks are incomplete for this exam.',
        errorCode: 'MARKS_INCOMPLETE',
      });
    }

    const mappingIds = mappings.map((m) => m.id);

    const markedMappings = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping_id: { in: mappingIds } },
      select: { exam_subject_mapping_id: true },
      distinct: ['exam_subject_mapping_id'],
    });

    const markedMappingIds = new Set(
      markedMappings.map((m) => m.exam_subject_mapping_id),
    );

    const hasIncompleteMapping = mappingIds.some(
      (id) => !markedMappingIds.has(id),
    );

    if (hasIncompleteMapping) {
      throw new UnprocessableEntityException({
        message: 'Marks are incomplete for this exam.',
        errorCode: 'MARKS_INCOMPLETE',
      });
    }

    const existingPublication = await this.prisma.result_publications.findFirst(
      {
        where: { exam_id: examId, publication_type: 'original' },
      },
    );

    if (existingPublication) {
      throw new ConflictException({
        message: 'Results have already been published for this exam.',
        errorCode: 'ALREADY_PUBLISHED',
      });
    }

    try {
      return await this.prisma.result_publications.create({
        data: {
          exam_id: examId,
          publication_type: 'original',
          published_by_user_id: publishedByUserId,
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while publishing results', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll() {
    try {
      return await this.prisma.result_publications.findMany({
        include: {
          exams: true,
          users: {
            select: {
              id: true,
              email: true,
              role_id: true,
              status: true,
            },
          },
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching results', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findOne(id: number) {
    let result: any;

    try {
      result = await this.prisma.result_publications.findUnique({
        where: { id },
        include: {
          exams: true,
          users: {
            select: {
              id: true,
              email: true,
              role_id: true,
              status: true,
            },
          },
        },
      });
    } catch (err: any) {
      this.logger.error('DB error while fetching result', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    if (!result) {
      throw new NotFoundException({
        message: 'Result not found.',
        errorCode: 'RESULT_NOT_FOUND',
      });
    }

    return result;
  }

  async update(id: number, updateResultDto: UpdateResultDto) {
    const existing = await this.prisma.result_publications.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Result not found.',
        errorCode: 'RESULT_NOT_FOUND',
      });
    }

    try {
      return await this.prisma.result_publications.update({
        where: { id },
        data: {
          publication_type: updateResultDto.publication_type,
          published_by_user_id: updateResultDto.published_by_user_id,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Result not found.',
          errorCode: 'RESULT_NOT_FOUND',
        });
      }

      this.logger.error('DB error while updating result', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
  // results.service.ts — add this method
  async remove(id: number) {
    const existing = await this.prisma.result_publications.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Result not found.',
        errorCode: 'RESULT_NOT_FOUND',
      });
    }

    try {
      await this.prisma.result_publications.delete({ where: { id } });
      return { id };
    } catch (err: any) {
      if (err?.code === 'P2025') {
        throw new NotFoundException({
          message: 'Result not found.',
          errorCode: 'RESULT_NOT_FOUND',
        });
      }

      this.logger.error('DB error while deleting result', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
