import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import {
  STUDENT_DISPLAY_INCLUDE,
  resolveStudentName,
  INTERNAL_ERROR,
} from 'src/modules/sports-admin/common/sports-common';
import { CreateFitnessTestDto } from './dto/create-fitness-test.dto';
import { UpdateFitnessTestDto } from './dto/update-fitness-test.dto';
import { SearchFitnessTestsDto } from './dto/search-fitness-tests.dto';

const FITNESS_TEST_INCLUDE = {
  students: { include: STUDENT_DISPLAY_INCLUDE },
} satisfies Prisma.sports_fitness_testsInclude;

type FitnessTestWithRelations = Prisma.sports_fitness_testsGetPayload<{
  include: typeof FITNESS_TEST_INCLUDE;
}>;

function toFitnessTestResponse(test: FitnessTestWithRelations) {
  return {
    id: test.id,
    student: {
      id: test.students.id,
      name: resolveStudentName(test.students),
    },
    test_name: test.test_name,
    score: test.score,
    test_date: test.test_date.toISOString().slice(0, 10),
    status: test.status,
    notes: test.notes,
  };
}

@Injectable()
export class FitnessService {
  private readonly logger = new Logger(FitnessService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /sports-admin/fitness-tests
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – student_id does not exist
   *  500 INTERNAL_ERROR – unexpected failure (DB, etc.)
   */
  async create(dto: CreateFitnessTestDto) {
    await this.assertStudentExists(dto.student_id);

    try {
      const test = await this.prisma.sports_fitness_tests.create({
        data: {
          student_id: dto.student_id,
          test_name: dto.test_name,
          score: dto.score,
          test_date: new Date(dto.test_date),
          status: dto.status,
          notes: dto.notes,
          recorded_by_staff_id: dto.recorded_by_staff_id,
        },
        include: FITNESS_TEST_INCLUDE,
      });
      return toFitnessTestResponse(test);
    } catch (err) {
      this.logger.error('DB error while creating fitness test', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** GET /sports-admin/fitness-tests?status=&q= */
  async findAll(dto: SearchFitnessTestsDto) {
    const where: Prisma.sports_fitness_testsWhereInput = {};
    if (dto.status) where.status = dto.status;
    if (dto.q) {
      where.OR = [
        { test_name: { contains: dto.q, mode: 'insensitive' } },
        {
          students: {
            soa_applications: {
              OR: [
                { first_name: { contains: dto.q, mode: 'insensitive' } },
                { last_name: { contains: dto.q, mode: 'insensitive' } },
              ],
            },
          },
        },
      ];
    }

    try {
      const tests = await this.prisma.sports_fitness_tests.findMany({
        where,
        include: FITNESS_TEST_INCLUDE,
        orderBy: { test_date: 'desc' },
      });
      return tests.map(toFitnessTestResponse);
    } catch (err) {
      this.logger.error('DB error while fetching fitness tests', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * GET /sports-admin/fitness-tests/:id
   *
   * Error cases:
   *  404 FITNESS_TEST_NOT_FOUND – no fitness test with the given id
   */
  async findOne(id: number) {
    const test = await this.findById(id);
    if (!test) {
      throw new NotFoundException({
        message: 'Fitness test not found',
        errorCode: 'FITNESS_TEST_NOT_FOUND',
      });
    }
    return toFitnessTestResponse(test);
  }

  /**
   * PATCH /sports-admin/fitness-tests/:id
   *
   * Error cases:
   *  404 FITNESS_TEST_NOT_FOUND – no fitness test with the given id
   *  404 STUDENT_NOT_FOUND – student_id does not exist
   */
  async update(id: number, dto: UpdateFitnessTestDto) {
    const test = await this.findById(id);
    if (!test) {
      throw new NotFoundException({
        message: 'Fitness test not found',
        errorCode: 'FITNESS_TEST_NOT_FOUND',
      });
    }

    if (dto.student_id) {
      await this.assertStudentExists(dto.student_id);
    }

    try {
      const updated = await this.prisma.sports_fitness_tests.update({
        where: { id },
        data: {
          student_id: dto.student_id,
          test_name: dto.test_name,
          score: dto.score,
          test_date: dto.test_date ? new Date(dto.test_date) : undefined,
          status: dto.status,
          notes: dto.notes,
          recorded_by_staff_id: dto.recorded_by_staff_id,
        },
        include: FITNESS_TEST_INCLUDE,
      });
      return toFitnessTestResponse(updated);
    } catch (err) {
      this.logger.error('DB error while updating fitness test', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * DELETE /sports-admin/fitness-tests/:id
   *
   * Error cases:
   *  404 FITNESS_TEST_NOT_FOUND – no fitness test with the given id
   */
  async remove(id: number) {
    const test = await this.findById(id);
    if (!test) {
      throw new NotFoundException({
        message: 'Fitness test not found',
        errorCode: 'FITNESS_TEST_NOT_FOUND',
      });
    }

    try {
      await this.prisma.sports_fitness_tests.delete({ where: { id } });
      return { message: 'Fitness test deleted successfully' };
    } catch (err) {
      this.logger.error('DB error while deleting fitness test', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  private async assertStudentExists(studentId: number) {
    let student: unknown;
    try {
      student = await this.prisma.students.findUnique({
        where: { id: studentId },
      });
    } catch (err) {
      this.logger.error('DB error during student lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
  }

  private async findById(id: number) {
    try {
      return await this.prisma.sports_fitness_tests.findUnique({
        where: { id },
        include: FITNESS_TEST_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during fitness test lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }
}
