import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateHallPlanDto } from './dto/create-hall-plan.dto';
import { UpdateHallPlanDto } from './dto/update-hall-plan.dto';
import { FindHallPlansQueryDto } from './dto/find-hall-plans-query.dto';

const VENUE_SELECT = {
  id: true,
  name: true,
  location: true,
  capacity: true,
} as const;

@Injectable()
export class HallPlansService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateHallPlanDto) {
    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const venue = await this.prisma.venues.findUnique({
      where: { id: dto.venue_id },
    });
    if (!venue) {
      throw new NotFoundException({
        message: 'Venue not found',
        errorCode: 'VENUE_NOT_FOUND',
      });
    }

    const capacity = dto.capacity ?? venue.capacity ?? null;

    if (
      capacity !== null &&
      venue.capacity !== null &&
      capacity > venue.capacity
    ) {
      throw new UnprocessableEntityException({
        message: `Capacity (${capacity}) cannot exceed the venue's physical capacity (${venue.capacity})`,
        errorCode: 'CAPACITY_EXCEEDS_VENUE',
      });
    }

    return this.prisma.hall_plans.create({
      data: {
        exam_id: dto.exam_id,
        venue_id: dto.venue_id,
        exam_date: new Date(dto.exam_date),
        capacity,
      },
      include: {
        venues: { select: VENUE_SELECT },
        _count: {
          select: { seating_arrangements: true, invigilation_duties: true },
        },
      },
    });
  }

  async findAll(query: FindHallPlansQueryDto) {
    const where: Prisma.hall_plansWhereInput = {};
    if (query.exam_id !== undefined) where.exam_id = query.exam_id;
    if (query.exam_date !== undefined)
      where.exam_date = new Date(query.exam_date);

    const [data, total] = await this.prisma.$transaction([
      this.prisma.hall_plans.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { id: 'asc' },
        include: {
          venues: { select: VENUE_SELECT },
          _count: {
            select: { seating_arrangements: true, invigilation_duties: true },
          },
        },
      }),
      this.prisma.hall_plans.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async findOne(id: number) {
    const hallPlan = await this.prisma.hall_plans.findUnique({
      where: { id },
      include: {
        exams: {
          select: {
            id: true,
            academic_year: true,
            semester: true,
            status: true,
          },
        },
        venues: { select: VENUE_SELECT },
        _count: {
          select: { seating_arrangements: true, invigilation_duties: true },
        },
      },
    });

    if (!hallPlan) {
      throw new NotFoundException({
        message: 'Hall plan not found',
        errorCode: 'HALL_PLAN_NOT_FOUND',
      });
    }

    return hallPlan;
  }

  async update(id: number, dto: UpdateHallPlanDto) {
    const existing = await this.prisma.hall_plans.findUnique({
      where: { id },
      include: {
        venues: { select: VENUE_SELECT },
        _count: { select: { seating_arrangements: true } },
      },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Hall plan not found',
        errorCode: 'HALL_PLAN_NOT_FOUND',
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

    let effectiveVenue = existing.venues;
    if (dto.venue_id !== undefined) {
      const venue = await this.prisma.venues.findUnique({
        where: { id: dto.venue_id },
      });
      if (!venue) {
        throw new NotFoundException({
          message: 'Venue not found',
          errorCode: 'VENUE_NOT_FOUND',
        });
      }
      effectiveVenue = venue;
    }

    const seatedCount = existing._count.seating_arrangements;
    const effectiveCapacity =
      dto.capacity !== undefined ? dto.capacity : existing.capacity;

    if (effectiveCapacity !== null && seatedCount > effectiveCapacity) {
      throw new UnprocessableEntityException({
        message: `Capacity cannot be reduced below the ${seatedCount} student(s) already allocated to this hall plan`,
        errorCode: 'CAPACITY_BELOW_ALLOCATED',
      });
    }

    if (
      effectiveCapacity !== null &&
      effectiveVenue.capacity !== null &&
      effectiveCapacity > effectiveVenue.capacity
    ) {
      throw new UnprocessableEntityException({
        message: `Capacity (${effectiveCapacity}) cannot exceed the venue's physical capacity (${effectiveVenue.capacity})`,
        errorCode: 'CAPACITY_EXCEEDS_VENUE',
      });
    }

    const data: Record<string, unknown> = {};
    if (dto.exam_id !== undefined) data.exam_id = dto.exam_id;
    if (dto.venue_id !== undefined) data.venue_id = dto.venue_id;
    if (dto.exam_date !== undefined) data.exam_date = new Date(dto.exam_date);
    if (dto.capacity !== undefined) data.capacity = dto.capacity;

    return this.prisma.hall_plans.update({
      where: { id },
      data,
      include: {
        venues: { select: VENUE_SELECT },
        _count: {
          select: { seating_arrangements: true, invigilation_duties: true },
        },
      },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.hall_plans.findUnique({
      where: { id },
      include: {
        _count: {
          select: { seating_arrangements: true, invigilation_duties: true },
        },
      },
    });

    if (!existing) {
      throw new NotFoundException({
        message: 'Hall plan not found',
        errorCode: 'HALL_PLAN_NOT_FOUND',
      });
    }

    if (existing._count.invigilation_duties > 0) {
      throw new ConflictException({
        message:
          'Cannot delete a hall plan that already has invigilation duties assigned to it',
        errorCode: 'HALL_PLAN_HAS_INVIGILATION_DUTIES',
      });
    }

    if (existing._count.seating_arrangements > 0) {
      throw new ConflictException({
        message:
          'Cannot delete a hall plan that already has students allocated to it',
        errorCode: 'HALL_PLAN_HAS_SEATED_STUDENTS',
      });
    }

    await this.prisma.hall_plans.delete({ where: { id } });

    return { id };
  }
}
