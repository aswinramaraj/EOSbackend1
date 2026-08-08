import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { ExamDateDto } from './dto/exam-date.dto';
import { UpdateSeatingArrangementDto } from './dto/update-seating-arrangement.dto';
import { FindSeatingArrangementsQueryDto } from './dto/find-seating-arrangements-query.dto';

const STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
} as const;

const HALL_PLAN_SELECT = {
  id: true,
  exam_id: true,
  exam_date: true,
  venues: { select: { id: true, name: true, location: true } },
};

@Injectable()
export class SeatingArrangementsService {
  constructor(private readonly prisma: PrismaService) {}

  async allocate(dto: ExamDateDto) {
    const examDate = new Date(dto.exam_date);

    const exam = await this.prisma.exams.findUnique({
      where: { id: dto.exam_id },
    });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: {
        exam_id: dto.exam_id,
        exam_timetable: { some: { exam_date: examDate } },
      },
      select: { class_id: true },
    });
    const classIds = [...new Set(mappings.map((m) => m.class_id))];

    if (classIds.length === 0) {
      throw new UnprocessableEntityException({
        message: 'No exam timetable is scheduled for this exam on this date',
        errorCode: 'NO_TIMETABLE_FOR_DATE',
      });
    }

    const eligibleStudents = await this.prisma.students.findMany({
      where: { class_id: { in: classIds } },
      select: { id: true },
      orderBy: [{ roll_no: 'asc' }, { id: 'asc' }],
    });

    if (eligibleStudents.length === 0) {
      throw new UnprocessableEntityException({
        message: 'No eligible students found for this exam on this date',
        errorCode: 'NO_ELIGIBLE_STUDENTS',
      });
    }

    const hallPlans = await this.prisma.hall_plans.findMany({
      where: { exam_id: dto.exam_id, exam_date: examDate },
      include: { venues: { select: { capacity: true } } },
      orderBy: { id: 'asc' },
    });

    if (hallPlans.length === 0) {
      throw new NotFoundException({
        message:
          'No hall plans exist for this exam on this date. Create hall plans before allocating seating.',
        errorCode: 'NO_HALL_PLANS_FOR_DATE',
      });
    }

    const totalCapacity = hallPlans.reduce(
      (sum, hp) => sum + (hp.capacity ?? hp.venues.capacity ?? 0),
      0,
    );

    if (eligibleStudents.length > totalCapacity) {
      throw new UnprocessableEntityException({
        message: `${eligibleStudents.length} eligible student(s) exceed the total available capacity (${totalCapacity}) across ${hallPlans.length} hall plan(s) for this exam date`,
        errorCode: 'CAPACITY_EXCEEDED',
      });
    }

    const rows: {
      hall_plan_id: number;
      student_id: number;
      seat_number: string;
    }[] = [];
    let cursor = 0;
    hallPlans.forEach((hallPlan, hallIndex) => {
      const capacity = hallPlan.capacity ?? hallPlan.venues.capacity ?? 0;
      const rowLabel = this.rowLabelFor(hallIndex);
      const studentsForHall = eligibleStudents.slice(cursor, cursor + capacity);
      studentsForHall.forEach((student, seatIndex) => {
        rows.push({
          hall_plan_id: hallPlan.id,
          student_id: student.id,
          seat_number: `${rowLabel}${seatIndex + 1}`,
        });
      });
      cursor += studentsForHall.length;
    });

    try {
      await this.prisma.$transaction(async (tx) => {
        const existingCount = await tx.seating_arrangements.count({
          where: { hall_plan_id: { in: hallPlans.map((hp) => hp.id) } },
        });

        if (existingCount > 0) {
          throw new ConflictException({
            message:
              'Seating has already been allocated for this exam/date. Clear existing seating before reallocating.',
            errorCode: 'SEATING_ALLOCATED',
          });
        }

        await tx.seating_arrangements.createMany({ data: rows });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          message:
            'Seating has already been allocated for this exam/date. Clear existing seating before reallocating.',
          errorCode: 'SEATING_ALLOCATED',
        });
      }
      throw error;
    }

    return this.findByExamDate(dto.exam_id, dto.exam_date);
  }

  async clearForExamDate(examId: number, examDate: string) {
    const hallPlans = await this.prisma.hall_plans.findMany({
      where: { exam_id: examId, exam_date: new Date(examDate) },
      select: { id: true },
    });
    const hallPlanIds = hallPlans.map((hp) => hp.id);

    if (hallPlanIds.length === 0) {
      throw new NotFoundException({
        message: 'No hall plans exist for this exam on this date',
        errorCode: 'NO_HALL_PLANS_FOR_DATE',
      });
    }

    const result = await this.prisma.seating_arrangements.deleteMany({
      where: { hall_plan_id: { in: hallPlanIds } },
    });

    return {
      exam_id: examId,
      exam_date: examDate,
      deleted_count: result.count,
    };
  }

  async findByExamDate(examId: number, examDate: string) {
    const hallPlans = await this.prisma.hall_plans.findMany({
      where: { exam_id: examId, exam_date: new Date(examDate) },
      select: { id: true },
    });
    const hallPlanIds = hallPlans.map((hp) => hp.id);

    return this.prisma.seating_arrangements.findMany({
      where: { hall_plan_id: { in: hallPlanIds } },
      include: {
        hall_plans: { select: HALL_PLAN_SELECT },
        students: { select: STUDENT_SELECT },
      },
      orderBy: [{ hall_plan_id: 'asc' }, { seat_number: 'asc' }],
    });
  }

  async findByHallPlan(hallPlanId: number) {
    const hallPlan = await this.prisma.hall_plans.findUnique({
      where: { id: hallPlanId },
    });
    if (!hallPlan) {
      throw new NotFoundException({
        message: 'Hall plan not found',
        errorCode: 'HALL_PLAN_NOT_FOUND',
      });
    }

    return this.prisma.seating_arrangements.findMany({
      where: { hall_plan_id: hallPlanId },
      include: { students: { select: STUDENT_SELECT } },
      orderBy: { seat_number: 'asc' },
    });
  }

  async findForStudent(examId: number, studentId: number) {
    const seat = await this.prisma.seating_arrangements.findFirst({
      where: { student_id: studentId, hall_plans: { exam_id: examId } },
      include: { hall_plans: { select: HALL_PLAN_SELECT } },
    });

    if (!seat) {
      throw new NotFoundException({
        message: 'No seating arrangement found for this student in this exam',
        errorCode: 'SEATING_ARRANGEMENT_NOT_FOUND',
      });
    }

    return seat;
  }

  async findAll(query: FindSeatingArrangementsQueryDto) {
    const where: Prisma.seating_arrangementsWhereInput = {};
    if (query.hall_plan_id !== undefined)
      where.hall_plan_id = query.hall_plan_id;
    if (query.student_id !== undefined) where.student_id = query.student_id;
    if (query.exam_id !== undefined)
      where.hall_plans = { exam_id: query.exam_id };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.seating_arrangements.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: [{ hall_plan_id: 'asc' }, { seat_number: 'asc' }],
        include: {
          hall_plans: { select: HALL_PLAN_SELECT },
          students: { select: STUDENT_SELECT },
        },
      }),
      this.prisma.seating_arrangements.count({ where }),
    ]);

    return paginate(data, total, query);
  }

  async findOne(id: number) {
    const seat = await this.prisma.seating_arrangements.findUnique({
      where: { id },
      include: {
        hall_plans: { select: HALL_PLAN_SELECT },
        students: { select: STUDENT_SELECT },
      },
    });

    if (!seat) {
      throw new NotFoundException({
        message: 'Seating arrangement not found',
        errorCode: 'SEATING_ARRANGEMENT_NOT_FOUND',
      });
    }

    return seat;
  }

  async update(id: number, dto: UpdateSeatingArrangementDto) {
    const existing = await this.prisma.seating_arrangements.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Seating arrangement not found',
        errorCode: 'SEATING_ARRANGEMENT_NOT_FOUND',
      });
    }

    let targetHallPlanId = existing.hall_plan_id;

    if (dto.hall_plan_id !== undefined) {
      const [targetHallPlan, originalHallPlan] = await Promise.all([
        this.prisma.hall_plans.findUnique({
          where: { id: dto.hall_plan_id },
          include: {
            venues: { select: { capacity: true } },
            _count: { select: { seating_arrangements: true } },
          },
        }),
        this.prisma.hall_plans.findUnique({
          where: { id: existing.hall_plan_id },
        }),
      ]);

      if (!targetHallPlan) {
        throw new NotFoundException({
          message: 'Hall plan not found',
          errorCode: 'HALL_PLAN_NOT_FOUND',
        });
      }

      if (
        originalHallPlan &&
        targetHallPlan.exam_id !== originalHallPlan.exam_id
      ) {
        throw new UnprocessableEntityException({
          message:
            'Cannot move a student to a hall plan belonging to a different exam',
          errorCode: 'HALL_PLAN_EXAM_MISMATCH',
        });
      }

      const capacity =
        targetHallPlan.capacity ?? targetHallPlan.venues.capacity ?? null;
      if (
        dto.hall_plan_id !== existing.hall_plan_id &&
        capacity !== null &&
        targetHallPlan._count.seating_arrangements >= capacity
      ) {
        throw new UnprocessableEntityException({
          message: 'Target hall plan is already at full capacity',
          errorCode: 'CAPACITY_EXCEEDED',
        });
      }

      targetHallPlanId = dto.hall_plan_id;
    }

    const seatNumber = dto.seat_number ?? existing.seat_number;

    const conflict = await this.prisma.seating_arrangements.findFirst({
      where: {
        hall_plan_id: targetHallPlanId,
        seat_number: seatNumber,
        NOT: { id },
      },
    });
    if (conflict) {
      throw new ConflictException({
        message: `Seat ${seatNumber} is already taken in this hall plan`,
        errorCode: 'DUPLICATE_SEAT_NUMBER',
      });
    }

    return this.prisma.seating_arrangements.update({
      where: { id },
      data: {
        hall_plan_id: dto.hall_plan_id,
        seat_number: dto.seat_number,
      },
      include: {
        hall_plans: { select: HALL_PLAN_SELECT },
        students: { select: STUDENT_SELECT },
      },
    });
  }

  async remove(id: number) {
    const existing = await this.prisma.seating_arrangements.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Seating arrangement not found',
        errorCode: 'SEATING_ARRANGEMENT_NOT_FOUND',
      });
    }

    await this.prisma.seating_arrangements.delete({ where: { id } });

    return { id };
  }

  private rowLabelFor(index: number): string {
    let label = '';
    let n = index;
    do {
      label = String.fromCharCode(65 + (n % 26)) + label;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    return label;
  }
}
