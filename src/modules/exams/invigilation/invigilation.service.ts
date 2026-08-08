import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateInvigilationDto } from './dto/create-invigilation.dto';
import { UpdateInvigilationDto } from './dto/update-invigilation.dto';
import { FindInvigilationQueryDto } from './dto/find-invigilation-query.dto';

const FACULTY_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  designation: true,
} as const;

const HALL_PLAN_SELECT = {
  id: true,
  exam_id: true,
  exam_date: true,
  venues: { select: { id: true, name: true, location: true } },
};

@Injectable()
export class InvigilationService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateInvigilationDto) {
    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const hallPlan = await this.prisma.hall_plans.findUnique({
      where: { id: dto.hall_plan_id },
    });
    if (!hallPlan) {
      throw new NotFoundException({
        message: 'Hall plan not found',
        errorCode: 'HALL_PLAN_NOT_FOUND',
      });
    }

    if (hallPlan.exam_id !== dto.exam_id) {
      throw new UnprocessableEntityException({
        message: 'The specified hall plan does not belong to this exam',
        errorCode: 'HALL_PLAN_NOT_IN_EXAM',
      });
    }

    const faculty = await this.prisma.faculty.findUnique({
      where: { id: dto.faculty_id },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'Faculty not found',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }

    const dutyDate = new Date(dto.duty_date);

    return this.prisma.$transaction(async (tx) => {
      const existingDuty = await tx.invigilation_duties.findFirst({
        where: {
          faculty_id: dto.faculty_id,
          duty_date: dutyDate,
          session: dto.session,
        },
      });

      if (existingDuty) {
        if (existingDuty.hall_plan_id === dto.hall_plan_id) {
          throw new ConflictException({
            message:
              'This faculty member is already assigned invigilation duty for this hall plan, date, and session',
            errorCode: 'DUPLICATE_INVIGILATION_ASSIGNMENT',
          });
        }
        throw new ConflictException({
          message:
            'This faculty member is already assigned invigilation duty in another hall for this date and session',
          errorCode: 'FACULTY_ALREADY_ASSIGNED',
        });
      }

      return tx.invigilation_duties.create({
        data: {
          exam_id: dto.exam_id,
          faculty_id: dto.faculty_id,
          hall_plan_id: dto.hall_plan_id,
          duty_date: dutyDate,
          session: dto.session,
        },
        include: {
          faculty: { select: FACULTY_SELECT },
          hall_plans: { select: HALL_PLAN_SELECT },
        },
      });
    });
  }

  async findAll(query: FindInvigilationQueryDto) {
    const where: Prisma.invigilation_dutiesWhereInput = {};
    if (query.exam_id !== undefined) where.exam_id = query.exam_id;
    if (query.hall_plan_id !== undefined)
      where.hall_plan_id = query.hall_plan_id;
    if (query.faculty_id !== undefined) where.faculty_id = query.faculty_id;
    if (query.duty_date !== undefined)
      where.duty_date = new Date(query.duty_date);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.invigilation_duties.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ duty_date: 'asc' }, { id: 'asc' }],
        include: {
          faculty: { select: FACULTY_SELECT },
          hall_plans: { select: HALL_PLAN_SELECT },
        },
      }),
      this.prisma.invigilation_duties.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async findOne(id: number) {
    const duty = await this.prisma.invigilation_duties.findUnique({
      where: { id },
      include: {
        faculty: { select: FACULTY_SELECT },
        hall_plans: { select: HALL_PLAN_SELECT },
        exams: {
          select: {
            id: true,
            academic_year: true,
            semester: true,
            status: true,
          },
        },
      },
    });

    if (!duty) {
      throw new NotFoundException({
        message: 'Invigilation duty not found',
        errorCode: 'INVIGILATION_DUTY_NOT_FOUND',
      });
    }

    return duty;
  }

  async update(id: number, dto: UpdateInvigilationDto) {
    const existing = await this.prisma.invigilation_duties.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Invigilation duty not found',
        errorCode: 'INVIGILATION_DUTY_NOT_FOUND',
      });
    }

    if (dto.exam_id !== undefined) {
      const exam = await this.prisma.exams.findUnique({
        where: { id: dto.exam_id },
      });
      if (!exam) {
        throw new NotFoundException({
          message: 'Exam not found',
          errorCode: 'EXAM_NOT_FOUND',
        });
      }
    }

    const examId = dto.exam_id ?? existing.exam_id;

    let hallPlan: { id: number; exam_id: number } | null = null;
    if (dto.hall_plan_id !== undefined) {
      hallPlan = await this.prisma.hall_plans.findUnique({
        where: { id: dto.hall_plan_id },
      });
      if (!hallPlan) {
        throw new NotFoundException({
          message: 'Hall plan not found',
          errorCode: 'HALL_PLAN_NOT_FOUND',
        });
      }
    } else if (dto.exam_id !== undefined) {
      hallPlan = await this.prisma.hall_plans.findUnique({
        where: { id: existing.hall_plan_id },
      });
    }

    if (hallPlan && hallPlan.exam_id !== examId) {
      throw new UnprocessableEntityException({
        message: 'The specified hall plan does not belong to this exam',
        errorCode: 'HALL_PLAN_NOT_IN_EXAM',
      });
    }

    if (dto.faculty_id !== undefined) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: dto.faculty_id },
      });
      if (!faculty) {
        throw new NotFoundException({
          message: 'Faculty not found',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
    }

    const facultyId = dto.faculty_id ?? existing.faculty_id;
    const hallPlanId = dto.hall_plan_id ?? existing.hall_plan_id;
    const dutyDate =
      dto.duty_date !== undefined
        ? new Date(dto.duty_date)
        : existing.duty_date;
    const session = dto.session !== undefined ? dto.session : existing.session;

    return this.prisma.$transaction(async (tx) => {
      const conflictRow = await tx.invigilation_duties.findFirst({
        where: {
          faculty_id: facultyId,
          duty_date: dutyDate,
          session,
          NOT: { id },
        },
      });

      if (conflictRow) {
        if (conflictRow.hall_plan_id === hallPlanId) {
          throw new ConflictException({
            message:
              'This faculty member is already assigned invigilation duty for this hall plan, date, and session',
            errorCode: 'DUPLICATE_INVIGILATION_ASSIGNMENT',
          });
        }
        throw new ConflictException({
          message:
            'This faculty member is already assigned invigilation duty in another hall for this date and session',
          errorCode: 'FACULTY_ALREADY_ASSIGNED',
        });
      }

      const data: Record<string, unknown> = {};
      if (dto.exam_id !== undefined) data.exam_id = dto.exam_id;
      if (dto.hall_plan_id !== undefined) data.hall_plan_id = dto.hall_plan_id;
      if (dto.faculty_id !== undefined) data.faculty_id = dto.faculty_id;
      if (dto.duty_date !== undefined) data.duty_date = dutyDate;
      if (dto.session !== undefined) data.session = dto.session;

      return tx.invigilation_duties.update({
        where: { id },
        data,
        include: {
          faculty: { select: FACULTY_SELECT },
          hall_plans: { select: HALL_PLAN_SELECT },
        },
      });
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.invigilation_duties.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Invigilation duty not found',
        errorCode: 'INVIGILATION_DUTY_NOT_FOUND',
      });
    }

    await this.prisma.invigilation_duties.delete({ where: { id } });

    return { id };
  }
}
