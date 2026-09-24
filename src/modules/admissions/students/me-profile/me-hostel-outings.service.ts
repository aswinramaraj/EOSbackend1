import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateHostelOutingDto } from './dto/create-hostel-outing.dto';
import { GetHostelOutingsDto } from './dto/get-hostel-outings.dto';

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

@Injectable()
export class MeHostelOutingsService {
  private readonly logger = new Logger(MeHostelOutingsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /me/hostel-outings
   *
   * Self-scoped: student_id resolved from the JWT, never accepted from the
   * request.
   *
   * The hosteller check (§3 step 5 / §5's documented 422 NOT_A_HOSTELLER)
   * is implemented, not left as an open question — despite being annotated
   * "Pending from Backend Implementation" in the workflow, the Error
   * Responses section fully specifies the exact errorCode/message, which
   * reads as "not yet built and confirmed in practice" rather than
   * "undecided whether to build." The schema itself has no FK tying
   * hostel_outings to student_hostel_mapping (confirmed: no such
   * constraint on hostel_outings.student_id), so this check is purely an
   * application-layer gate, matching the spec's own framing.
   *
   * Response includes `room_number` — an addition beyond the spec's
   * example response (which shows no hostel/room context at all). The
   * hosteller check already has to read student_hostel_mapping joined to
   * hostel_rooms, so surfacing which room this outing request pertains to
   * costs nothing extra, rather than leaving the client to look it up
   * separately.
   *
   * start_time/return_time are stored as Postgres TIME columns
   * (`@db.Time(6)`); Prisma/pg represent these as JS Date objects with an
   * arbitrary date portion, so HH:MM strings are converted to/from a fixed
   * 1970-01-01 reference date on the way in and out.
   *
   * Same-day return-before-departure check (found during a recheck, not in
   * the spec's own Validation Rules): confirmed live that a same-day outing
   * with return_time earlier than start_time (e.g. depart 18:00, "return"
   * 09:00 the same date) was silently accepted, implying a negative
   * duration. For a multi-day outing (from_date < to_date), return_time's
   * clock reading legitimately can be "earlier" than start_time's — the
   * return happens on a later date regardless of the HH:MM portion — so
   * this check only applies when from_date === to_date. Reuses the
   * INVALID_DATE_RANGE errorCode (this is still fundamentally a date/time
   * ordering problem) with a message specific to this case.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student
   *                           record (spec doesn't list this code, kept
   *                           for consistency with every sibling /me/*
   *                           endpoint)
   *  422 INVALID_DATE_RANGE – from_date in the past, from_date > to_date,
   *                           or (same-day outing) return_time < start_time
   *  422 NOT_A_HOSTELLER    – caller has no student_hostel_mapping row
   *  500 INTERNAL_ERROR     – unexpected DB failure
   */
  async createHostelOuting(userId: number, dto: CreateHostelOutingDto) {
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

    const hostelMapping = await this.prisma.student_hostel_mapping.findUnique({
      where: { student_id: student.id },
      select: { hostel_rooms: { select: { room_number: true } } },
    });
    if (!hostelMapping) {
      throw new UnprocessableEntityException({
        message: 'Only hostellers can request outings',
        errorCode: 'NOT_A_HOSTELLER',
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
      room_number: hostelMapping.hostel_rooms.room_number,
    };
  }

  /**
   * GET /me/hostel-outings?status=&page=&page_size=
   *
   * Self-scoped: student_id resolved from the JWT. Unlike the POST sibling,
   * this endpoint does NOT gate on hosteller status (per
   * todo.md/15-GET-me-hostel-outings.md §3 step 7 / §8) — a day scholar,
   * or a hosteller whose mapping has since been removed, simply gets an
   * empty or historical list, never a 422. There's nothing to protect by
   * blocking a read of "your own rows, of which there may be zero."
   *
   * `approved_by_warden` resolves to `users.email` (not a name — `users`
   * has no name column, same gap already documented for GET /me/leaves'
   * `approved_by_hod`), null until a warden acts (no such endpoint exists
   * yet anywhere in the reviewed schema).
   *
   * `room_number` reflects the student's CURRENT student_hostel_mapping at
   * read time, not a per-request historical snapshot — the schema has no
   * versioned room-assignment history to draw from instead (documented in
   * the spec's own Business Rules and Known Limitations).
   *
   * Error cases:
   *  400 VALIDATION_ERROR  – status isn't a real enum value
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student
   *                          record (spec doesn't list this code, kept
   *                          for consistency with every sibling /me/*
   *                          endpoint)
   *  500 INTERNAL_ERROR    – unexpected DB failure
   */
  async getMyHostelOutings(userId: number, dto: GetHostelOutingsDto) {
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

    return this.computeHostelOutings(student.id, dto);
  }

  /**
   * Same computation as getMyHostelOutings, but for a student chosen by id
   * rather than resolved from the caller's own JWT - used by ParentsService
   * once it has verified (via parent_student_mapping) that the caller is
   * actually this student's parent. Read-only: there is no
   * createOutingForStudentId, a parent never files an outing on a child's
   * behalf.
   */
  async getHostelOutingsForStudentId(
    studentId: number,
    dto: GetHostelOutingsDto,
  ) {
    return this.computeHostelOutings(studentId, dto);
  }

  private async computeHostelOutings(
    studentId: number,
    dto: GetHostelOutingsDto,
  ) {
    const page = dto.page ?? 1;
    const pageSize = dto.page_size ?? 20;

    const [total, rows] = await this.fetchOutings(
      studentId,
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
        approved_by_warden: row.users?.email ?? null,
        room_number:
          row.students.student_hostel_mapping?.hostel_rooms.room_number ?? null,
        created_at: row.created_at.toISOString(),
      })),
      page,
      page_size: pageSize,
      total,
    };
  }

  private async fetchOutings(
    studentId: number,
    status: GetHostelOutingsDto['status'],
    page: number,
    pageSize: number,
  ) {
    const where = {
      student_id: studentId,
      ...(status !== undefined ? { status } : {}),
    };

    try {
      return await Promise.all([
        this.prisma.hostel_outings.count({ where }),
        this.prisma.hostel_outings.findMany({
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
            users: { select: { email: true } },
            students: {
              select: {
                student_hostel_mapping: {
                  select: { hostel_rooms: { select: { room_number: true } } },
                },
              },
            },
          },
          orderBy: { created_at: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to fetch hostel outings for student ${studentId}`,
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
    dto: CreateHostelOutingDto,
    fromDate: Date,
    toDate: Date,
  ) {
    try {
      return await this.prisma.hostel_outings.create({
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
        `Failed to create hostel outing request for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
