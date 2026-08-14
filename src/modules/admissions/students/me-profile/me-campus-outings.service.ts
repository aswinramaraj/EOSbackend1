import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateCampusOutingDto } from './dto/create-campus-outing.dto';
import { GetCampusOutingsDto } from './dto/get-campus-outings.dto';

function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function toTimeOnly(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function toTimeDate(time: string): Date {
  return new Date(`1970-01-01T${time}:00.000Z`);
}

/**
 * Student side of the "In / out" tab — a campus gate pass, open to every
 * student (day scholar or hosteller), unlike MeHostelOutingsService's
 * hosteller-gated /me/hostel-outings. Routes to the Faculty mentor (as
 * "Advisor") then the HoD, same chain as MeLeavesService/
 * student-leaves.service.ts, but on its own table
 * (campus_outing_requests) — see prisma/README.md for why.
 */
@Injectable()
export class MeCampusOutingsService {
  private readonly logger = new Logger(MeCampusOutingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /me/campus-outings
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student record
   *  422 INVALID_DATE_RANGE – from_date in the past, from_date > to_date, or
   *                           (same-day outing) return_time < start_time
   *                           (same check as MeHostelOutingsService)
   *  500 INTERNAL_ERROR     – unexpected DB failure
   */
  async createCampusOuting(userId: number, dto: CreateCampusOutingDto) {
    const fromDate = new Date(dto.from_date);
    const toDate = new Date(dto.to_date);
    if (fromDate < startOfToday() || fromDate > toDate) {
      throw new UnprocessableEntityException({
        message:
          'from_date must not be in the past and must be on or before to_date',
        errorCode: 'INVALID_DATE_RANGE',
      });
    }
    if (
      dto.return_time &&
      dto.from_date === dto.to_date &&
      dto.return_time < dto.start_time
    ) {
      throw new UnprocessableEntityException({
        message:
          'return_time must not be before start_time for a same-day outing',
        errorCode: 'INVALID_DATE_RANGE',
      });
    }

    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const outing = await this.insertOuting(
      userId,
      student.id,
      dto,
      fromDate,
      toDate,
    );

    return {
      id: outing.id,
      from_date: toDateOnly(outing.from_date),
      to_date: toDateOnly(outing.to_date),
      start_time: toTimeOnly(outing.start_time),
      return_time: outing.return_time ? toTimeOnly(outing.return_time) : null,
      reason: outing.reason,
      status: outing.status,
      approved_by_faculty_id: outing.approved_by_faculty_id,
      approved_by_hod_user_id: outing.approved_by_hod_user_id,
    };
  }

  /**
   * GET /me/campus-outings?status=&page=&page_size=
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student record
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyCampusOutings(userId: number, dto: GetCampusOutingsDto) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const page = dto.page ?? 1;
    const pageSize = dto.page_size ?? 20;

    const [total, rows] = await this.fetchOutings(
      userId,
      student.id,
      dto.status,
      page,
      pageSize,
    );

    return {
      data: rows.map((row) => ({
        id: row.id,
        from_date: toDateOnly(row.from_date),
        to_date: toDateOnly(row.to_date),
        start_time: toTimeOnly(row.start_time),
        return_time: row.return_time ? toTimeOnly(row.return_time) : null,
        reason: row.reason,
        status: row.status,
        approved_by_faculty: row.faculty
          ? `${row.faculty.first_name} ${row.faculty.last_name}`
          : null,
        approved_by_hod: row.users?.email ?? null,
        created_at: row.created_at.toISOString(),
      })),
      page,
      page_size: pageSize,
      total,
    };
  }

  private async fetchOutings(
    userId: number,
    studentId: number,
    status: GetCampusOutingsDto['status'],
    page: number,
    pageSize: number,
  ) {
    const where = {
      student_id: studentId,
      ...(status !== undefined ? { status } : {}),
    };

    try {
      return await Promise.all([
        this.prisma.campus_outing_requests.count({ where }),
        this.prisma.campus_outing_requests.findMany({
          where,
          select: {
            id: true,
            from_date: true,
            to_date: true,
            start_time: true,
            return_time: true,
            reason: true,
            status: true,
            created_at: true,
            faculty: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
          },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to fetch campus outings for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private async insertOuting(
    userId: number,
    studentId: number,
    dto: CreateCampusOutingDto,
    fromDate: Date,
    toDate: Date,
  ) {
    try {
      return await this.prisma.campus_outing_requests.create({
        data: {
          student_id: studentId,
          from_date: fromDate,
          to_date: toDate,
          start_time: toTimeDate(dto.start_time),
          return_time: dto.return_time ? toTimeDate(dto.return_time) : null,
          reason: dto.reason,
          status: 'pending',
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to create campus outing request for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
