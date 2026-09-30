import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import { isUndefinedColumnError } from 'src/common/utils/pg-error.util';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { CreateAttendanceDto } from './dto/create-attendance.dto';
import { UpdateAttendanceDto } from './dto/update-attendance.dto';
import { ListAttendanceQueryDto } from './dto/list-attendance-query.dto';
import { MarkClassAttendanceDto } from './dto/mark-class-attendance.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

// is_published/published_at are NOT declared in schema.prisma (deliberately
// not touching that file) — they're read/written via raw SQL below
// (rawGetPublishState / rawSetPublishState) and merged into the response
// after the normal typed Prisma query, instead of being part of this select.
const ATTENDANCE_SELECT = {
  id: true,
  attendance_date: true,
  status: true,
  classes: {
    select: {
      id: true,
      section: true,
      departments: { select: { id: true, name: true, code: true } },
    },
  },
  subjects: { select: { id: true, name: true, subject_code: true } },
  faculty: { select: { id: true, first_name: true, last_name: true } },
  users: {
    select: {
      id: true,
      email: true,
      faculty: { select: { first_name: true, last_name: true } },
      non_teaching_staff: { select: { first_name: true, last_name: true } },
    },
  },
  students: {
    select: {
      id: true,
      student_id_no: true,
      roll_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
    },
  },
} as const;

interface AttendanceMarkerRow {
  id: number;
  email: string;
  faculty: { first_name: string; last_name: string } | null;
  non_teaching_staff: { first_name: string; last_name: string | null }[];
}

interface AttendanceRow {
  id: number;
  attendance_date: Date;
  status: string;
  classes: {
    id: number;
    section: string;
    departments: { id: number; name: string; code: string };
  };
  subjects: { id: number; name: string; subject_code: string } | null;
  // marked_by_faculty_id (schema.prisma) is nullable — attendance can be
  // marked by any user via marked_by_user_id, with this faculty relation
  // populated only when that marker happens to be a faculty member.
  faculty: { id: number; first_name: string; last_name: string } | null;
  users: AttendanceMarkerRow;
  students: {
    id: number;
    student_id_no: string;
    roll_no: string | null;
    soa_applications: { first_name: string; last_name: string | null } | null;
  };
}

/**
 * `marked_by_user_id` (generic — any role) is always present; the direct
 * `faculty` relation (via `marked_by_faculty_id`) is only set when the
 * marker is teaching staff (null for Secretary-marked rows). Mirrors
 * VenuesService.resolveBookerName's faculty-then-non_teaching_staff-then-
 * email fallback for display purposes.
 */
function resolveMarkerName(marker: AttendanceMarkerRow): string {
  if (marker.faculty) {
    return `${marker.faculty.first_name} ${marker.faculty.last_name}`;
  }
  const staff = marker.non_teaching_staff[0];
  if (staff) {
    return staff.last_name
      ? `${staff.first_name} ${staff.last_name}`
      : staff.first_name;
  }
  return marker.email;
}

/** publishState is fetched separately via raw SQL (see rawGetPublishState)
 * since is_published/published_at aren't declared in schema.prisma. */
function toResponse(
  record: AttendanceRow,
  publishState?: { is_published: boolean; published_at: Date | null },
) {
  return {
    id: record.id,
    date: record.attendance_date,
    status: record.status,
    is_published: publishState?.is_published ?? true,
    published_at: publishState?.published_at ?? null,
    class: {
      id: record.classes.id,
      section: record.classes.section,
      department: record.classes.departments,
    },
    subject: record.subjects,
    faculty: record.faculty,
    marked_by: {
      id: record.users.id,
      name: resolveMarkerName(record.users),
    },
    student: {
      id: record.students.id,
      student_id_no: record.students.student_id_no,
      roll_no: record.students.roll_no,
      first_name: record.students.soa_applications?.first_name ?? null,
      last_name: record.students.soa_applications?.last_name ?? null,
    },
  };
}

@Injectable()
export class AttendanceService {
  private readonly logger = new Logger(AttendanceService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------
  // Raw-SQL publish-state helpers.
  //
  // attendance_records.is_published / published_at are real DB columns but
  // are deliberately NOT declared in schema.prisma (schema.prisma is not to
  // be touched) — these two columns must be added to the database directly
  // by running the SQL below once, then every read/write of them goes
  // through $queryRaw/$executeRaw instead of the generated Prisma Client.
  //
  // Run this once against the real DB before using Save/Publish:
  //
  //   ALTER TABLE attendance_records
  //     ADD COLUMN IF NOT EXISTS is_published boolean NOT NULL DEFAULT true,
  //     ADD COLUMN IF NOT EXISTS published_at timestamp NULL;
  //
  // (DEFAULT true so every historical row already marked under the old
  // always-final behavior stays visible; new rows are explicitly set to
  // false by rawInsertDraftStatus below.)
  // ---------------------------------------------------------------------

  private async rawGetPublishState(
    classId: number,
    subjectId: number,
    attendanceDate: Date,
    periodNumber: number,
  ): Promise<{ is_published: boolean; published_at: Date | null }[]> {
    try {
      return await this.prisma.$queryRaw<
        { is_published: boolean; published_at: Date | null }[]
      >`SELECT is_published, published_at FROM attendance_records
         WHERE class_id = ${classId} AND subject_id = ${subjectId}
           AND attendance_date = ${attendanceDate} AND period_number = ${periodNumber}`;
    } catch (err) {
      if (isUndefinedColumnError(err, 'period_number')) {
        return this.prisma.$queryRaw<
          { is_published: boolean; published_at: Date | null }[]
        >`SELECT is_published, published_at FROM attendance_records
           WHERE class_id = ${classId} AND subject_id = ${subjectId} AND attendance_date = ${attendanceDate}`;
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // Raw-SQL period helpers (see attendance_periods.query.md — Domain 06
  // checklist item A0). period_number is an additive column, same
  // not-in-schema.prisma convention as is_published/published_at above;
  // every helper here falls back to the old class+subject+date-only scope
  // (today's exact behavior) if the column doesn't exist yet.
  // ---------------------------------------------------------------------

  /** ids of existing rows for this exact class/subject/date/period — used to decide draft-replace scope so saving one period never wipes another's rows. */
  private async rawFindIdsForPeriod(
    classId: number,
    subjectId: number,
    attendanceDate: Date,
    periodNumber: number,
  ): Promise<number[]> {
    try {
      const rows = await this.prisma.$queryRaw<{ id: number }[]>`
        SELECT id FROM attendance_records
        WHERE class_id = ${classId} AND subject_id = ${subjectId}
          AND attendance_date = ${attendanceDate} AND period_number = ${periodNumber}`;
      return rows.map((r) => r.id);
    } catch (err) {
      if (isUndefinedColumnError(err, 'period_number')) {
        const rows = await this.prisma.$queryRaw<{ id: number }[]>`
          SELECT id FROM attendance_records
          WHERE class_id = ${classId} AND subject_id = ${subjectId} AND attendance_date = ${attendanceDate}`;
        return rows.map((r) => r.id);
      }
      throw err;
    }
  }

  /** Persists period_number on newly-inserted rows; silently a no-op pre-migration (rows stay implicitly "period 1", identical to today). */
  private async rawSetPeriodNumber(ids: number[], periodNumber: number) {
    if (ids.length === 0 || periodNumber === 1) return;
    try {
      await this.prisma
        .$executeRaw`UPDATE attendance_records SET period_number = ${periodNumber} WHERE id = ANY(${ids})`;
    } catch (err) {
      if (isUndefinedColumnError(err, 'period_number')) return;
      throw err;
    }
  }

  private async rawGetPublishStateByIds(
    ids: number[],
  ): Promise<
    Map<number, { is_published: boolean; published_at: Date | null }>
  > {
    if (ids.length === 0) return new Map();
    const rows = await this.prisma.$queryRaw<
      { id: number; is_published: boolean; published_at: Date | null }[]
    >`SELECT id, is_published, published_at FROM attendance_records WHERE id = ANY(${ids})`;
    return new Map(
      rows.map((r) => [
        r.id,
        { is_published: r.is_published, published_at: r.published_at },
      ]),
    );
  }

  private async rawSetIsPublished(
    ids: number[],
    value: boolean,
    publishedAt: Date | null,
  ) {
    if (ids.length === 0) return;
    await this.prisma
      .$executeRaw`UPDATE attendance_records SET is_published = ${value}, published_at = ${publishedAt} WHERE id = ANY(${ids})`;
  }

  private async rawSetIsPublishedFalse(ids: number[]) {
    if (ids.length === 0) return;
    await this.prisma
      .$executeRaw`UPDATE attendance_records SET is_published = false, published_at = NULL WHERE id = ANY(${ids})`;
  }

  // ---------------------------------------------------------------------
  // Raw-SQL review-state helpers (see attendance_review_workflow.query.md).
  // submitted_for_review_at/reviewed_by_user_id are additive columns, same
  // not-in-schema.prisma convention as is_published/published_at above.
  // ---------------------------------------------------------------------

  private async rawGetReviewStateByIds(
    ids: number[],
  ): Promise<Map<number, { submitted_for_review_at: Date | null }>> {
    if (ids.length === 0) return new Map();
    try {
      const rows = await this.prisma.$queryRaw<
        { id: number; submitted_for_review_at: Date | null }[]
      >`SELECT id, submitted_for_review_at FROM attendance_records WHERE id = ANY(${ids})`;
      return new Map(
        rows.map((r) => [r.id, { submitted_for_review_at: r.submitted_for_review_at }]),
      );
    } catch (err) {
      if (isUndefinedColumnError(err, 'submitted_for_review_at')) return new Map();
      throw err;
    }
  }

  private async rawSetSubmittedForReview(ids: number[]) {
    if (ids.length === 0) return;
    try {
      await this.prisma
        .$executeRaw`UPDATE attendance_records SET submitted_for_review_at = now() WHERE id = ANY(${ids})`;
    } catch (err) {
      if (isUndefinedColumnError(err, 'submitted_for_review_at')) {
        throw new UnprocessableEntityException({
          message: 'This feature is not enabled yet.',
          errorCode: 'FEATURE_NOT_ENABLED',
        });
      }
      throw err;
    }
  }

  private async rawApproveReview(
    ids: number[],
    reviewerUserId: number,
    publishedAt: Date,
  ) {
    if (ids.length === 0) return;
    try {
      await this.prisma
        .$executeRaw`UPDATE attendance_records SET is_published = true, published_at = ${publishedAt}, reviewed_by_user_id = ${reviewerUserId} WHERE id = ANY(${ids})`;
    } catch (err) {
      if (isUndefinedColumnError(err, 'reviewed_by_user_id')) {
        throw new UnprocessableEntityException({
          message: 'This feature is not enabled yet.',
          errorCode: 'FEATURE_NOT_ENABLED',
        });
      }
      throw err;
    }
  }

  private async rawSendBackReview(ids: number[]) {
    if (ids.length === 0) return;
    try {
      await this.prisma
        .$executeRaw`UPDATE attendance_records SET submitted_for_review_at = NULL WHERE id = ANY(${ids})`;
    } catch (err) {
      if (isUndefinedColumnError(err, 'submitted_for_review_at')) {
        throw new UnprocessableEntityException({
          message: 'This feature is not enabled yet.',
          errorCode: 'FEATURE_NOT_ENABLED',
        });
      }
      throw err;
    }
  }

  /**
   * POST /attendance (Faculty / Secretary).
   *
   * Marks attendance for every student in dto.records for one class session
   * (class + optional subject + date), all inside a single transaction —
   * either every row is inserted or none are. `marked_by_user_id` is always
   * set from the caller's own id; `marked_by_faculty_id` is only populated
   * when the caller actually has a faculty profile (Secretary doesn't).
   */
  async create(dto: CreateAttendanceDto, userId: number, userRole?: string) {
    // Secretary added for the Secretary Portal's Bulk Attendance "Mark" tab
    // — has no `faculty` table row, so is handled here exactly like
    // MediaRequestsService's Secretary branch: skip the faculty-profile
    // lookup and leave marked_by_faculty_id null (the column is already
    // nullable — see this file's own comment on `faculty` in AttendanceRow).
    const faculty =
      userRole === ROLES.SECRETARY
        ? null
        : await this.resolveFacultyByUserId(userId);

    const klass = await this.prisma.classes.findUnique({
      where: { id: dto.class_id },
      select: {
        id: true,
        section: true,
        batch_id: true,
        current_semester: true,
        departments: { select: { id: true, name: true, code: true } },
      },
    });
    if (!klass) {
      throw new NotFoundException('Class not found');
    }

    let subject: { id: number; name: string; subject_code: string } | null =
      null;
    if (dto.subject_id !== undefined) {
      subject = await this.prisma.subjects.findUnique({
        where: { id: dto.subject_id },
        select: { id: true, name: true, subject_code: true },
      });
      if (!subject) {
        throw new NotFoundException('Subject not found');
      }

      // Same check markForClass() already enforces — this legacy endpoint
      // previously let any FACULTY account mark attendance for a
      // subject/class they aren't actually assigned to teach. Secretary is
      // exempt (no faculty row, not subject-scoped by design).
      if (faculty) {
        const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
          where: {
            faculty_id: faculty.id,
            subject_id: dto.subject_id,
            class_id: dto.class_id,
          },
        });
        if (!mapping) {
          throw new ForbiddenException({
            message: 'You are not assigned to teach this subject for this class',
            errorCode: 'NOT_MAPPED_TO_TEACH',
          });
        }
      }
    }

    const studentIds = dto.records.map((r) => r.student_id);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('Duplicate student_id values in records');
    }

    const students = await this.prisma.students.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, class_id: true },
    });

    const foundIds = new Set(students.map((s) => s.id));
    const missingIds = studentIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Student(s) not found: ${missingIds.join(', ')}`,
      );
    }

    const notInClassIds = students
      .filter((s) => s.class_id !== dto.class_id)
      .map((s) => s.id);
    if (notInClassIds.length > 0) {
      throw new BadRequestException(
        `Student(s) do not belong to class ${dto.class_id}: ${notInClassIds.join(', ')}`,
      );
    }

    const attendanceDate = new Date(dto.date);
    await this.assertNotHoliday(
      klass.batch_id,
      klass.current_semester,
      attendanceDate,
    );
    const subjectFilterValue = dto.subject_id ?? null;
    // See attendance_periods.query.md (Domain 06 checklist item A0) — a
    // second occurrence of the same subject/class/date is a distinct period,
    // not a duplicate. Pre-migration, every row is implicitly period 1.
    const periodNumber = dto.period_number ?? 1;

    let created: Array<{ id: number; student_id: number; status: string }>;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        // Postgres treats NULL <> NULL in unique indexes, so
        // @@unique([student_id, class_id, subject_id, attendance_date])
        // does NOT actually block two concurrent creates for the same
        // student/class/date when subject_id is null (the common case here,
        // since it's optional) — two requests could both pass the
        // check-then-write below with no DB-level backstop. An advisory
        // lock scoped to this exact (class, subject, date, period)
        // combination serializes concurrent create() calls for it, so the
        // second request's own check below correctly sees what the first
        // one just inserted, rather than racing past it.
        const lockKey = `attendance:${dto.class_id}:${subjectFilterValue ?? 'null'}:${dto.date}:${periodNumber}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        let alreadyMarked: { student_id: number }[];
        try {
          alreadyMarked = await tx.$queryRaw<{ student_id: number }[]>`
            SELECT student_id FROM attendance_records
            WHERE class_id = ${dto.class_id} AND subject_id IS NOT DISTINCT FROM ${subjectFilterValue}
              AND attendance_date = ${attendanceDate} AND period_number = ${periodNumber}
              AND student_id = ANY(${studentIds})`;
        } catch (err) {
          if (!isUndefinedColumnError(err, 'period_number')) throw err;
          alreadyMarked = await tx.$queryRaw<{ student_id: number }[]>`
            SELECT student_id FROM attendance_records
            WHERE class_id = ${dto.class_id} AND subject_id IS NOT DISTINCT FROM ${subjectFilterValue}
              AND attendance_date = ${attendanceDate}
              AND student_id = ANY(${studentIds})`;
        }
        if (alreadyMarked.length > 0) {
          throw new ConflictException(
            `Attendance already marked for student(s): ${alreadyMarked.map((r) => r.student_id).join(', ')}`,
          );
        }

        // One INSERT ... RETURNING for the whole class instead of N
        // sequential creates (docs/production/PERFORMANCE_AUDIT.md §2 row 7
        // — every attendance-marking action, every class/period/day).
        const rows = await tx.attendance_records.createManyAndReturn({
          data: dto.records.map((r) => ({
            student_id: r.student_id,
            class_id: dto.class_id,
            subject_id: dto.subject_id,
            attendance_date: attendanceDate,
            status: r.status,
            marked_by_faculty_id: faculty?.id ?? null,
            marked_by_user_id: userId,
          })),
          select: { id: true, student_id: true, status: true },
        });
        if (periodNumber !== 1) {
          try {
            await tx.$executeRaw`UPDATE attendance_records SET period_number = ${periodNumber} WHERE id = ANY(${rows.map((r) => r.id)})`;
          } catch (err) {
            if (!isUndefinedColumnError(err, 'period_number')) throw err;
          }
        }
        return rows;
      });
    } catch (err: unknown) {
      if (err instanceof ConflictException) {
        throw err;
      }
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException(
          'Attendance already marked for one or more students',
        );
      }
      this.logger.error('Attendance creation transaction failed', err);
      throw err;
    }

    this.logger.log(
      `Attendance marked: class=${dto.class_id} date=${dto.date} records=${created.length}`,
    );

    return {
      class: {
        id: klass.id,
        section: klass.section,
        department: klass.departments,
      },
      subject,
      faculty: faculty
        ? {
            id: faculty.id,
            first_name: faculty.first_name,
            last_name: faculty.last_name,
          }
        : null,
      date: dto.date,
      total_present: created.filter((r) => r.status === 'present').length,
      total_absent: created.filter((r) => r.status === 'absent').length,
      total_on_duty: created.filter((r) => r.status === 'on_duty').length,
      records: created,
    };
  }

  /**
   * POST /me/classes/:class_id/attendance (Faculty only).
   *
   * Distinct from POST /attendance above: this route requires subject_id
   * (not optional) and additionally verifies the caller is actually mapped
   * (faculty_subject_class_mapping) to teach that subject for this class —
   * a check the older endpoint doesn't perform. The mapping check is scoped
   * by academic_year when provided, so a mapping that lapsed in a prior year
   * doesn't keep authorizing attendance today (same convention as Lesson
   * Plans/LMS Notes/Timetable's equivalent checks). Duplicate detection here
   * is whole-combination (any existing row for class+subject+date blocks the
   * entire batch with one 409), matching this endpoint's documented
   * contract, rather than the older endpoint's per-student duplicate list.
   */
  async markForClass(
    classId: number,
    dto: MarkClassAttendanceDto,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
    });
    if (!klass) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const subject = await this.prisma.subjects.findUnique({
      where: { id: dto.subject_id },
    });
    if (!subject) {
      throw new NotFoundException({
        message: 'Subject not found',
        errorCode: 'SUBJECT_NOT_FOUND',
      });
    }

    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: {
        faculty_id: faculty.id,
        subject_id: dto.subject_id,
        class_id: classId,
        ...(dto.academic_year !== undefined && {
          academic_year: dto.academic_year,
        }),
      },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: 'You are not assigned to teach this subject for this class',
        errorCode: 'NOT_MAPPED_TO_TEACH',
      });
    }

    const attendanceDate = new Date(dto.attendance_date);
    const today = new Date(new Date().toISOString().slice(0, 10));
    if (attendanceDate > today) {
      throw new BadRequestException(
        'attendance_date must not be in the future',
      );
    }
    await this.assertNotHoliday(
      klass.batch_id,
      klass.current_semester,
      attendanceDate,
    );

    const studentIds = dto.records.map((r) => r.student_id);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('Duplicate student_id values in records');
    }

    const students = await this.prisma.students.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, class_id: true },
    });

    const foundIds = new Set(students.map((s) => s.id));
    const missingIds = studentIds.filter((id) => !foundIds.has(id));
    if (missingIds.length > 0) {
      throw new NotFoundException(
        `Student(s) not found: ${missingIds.join(', ')}`,
      );
    }

    const notInClassIds = students
      .filter((s) => s.class_id !== classId)
      .map((s) => s.id);
    if (notInClassIds.length > 0) {
      throw new UnprocessableEntityException({
        message: 'One or more students do not belong to this class',
        errorCode: 'STUDENT_NOT_IN_CLASS',
      });
    }

    // See attendance_periods.query.md (Domain 06 checklist item A0) — a
    // second occurrence of the same subject/class/date is a distinct period,
    // not the same draft. Pre-migration, every row is implicitly period 1,
    // so this scopes identically to the old class+subject+date-only checks.
    const periodNumber = dto.period_number ?? 1;
    const existingIds = await this.rawFindIdsForPeriod(
      classId,
      dto.subject_id,
      attendanceDate,
      periodNumber,
    );
    const publishState = await this.rawGetPublishState(
      classId,
      dto.subject_id,
      attendanceDate,
      periodNumber,
    );
    // Once published, attendance is final — matches Subject Records marks
    // locking after publish. Before publish it's a draft: re-marking the
    // same class/subject/date/period just replaces that period's draft rows
    // so Save can be clicked repeatedly while editing.
    if (publishState.some((r) => r.is_published)) {
      throw new ConflictException({
        message:
          'Attendance has already been published for this class, subject, and date',
        errorCode: 'ATTENDANCE_ALREADY_PUBLISHED',
      });
    }

    let created: Array<{ id: number }>;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        if (existingIds.length > 0) {
          await tx.attendance_records.deleteMany({
            where: { id: { in: existingIds } },
          });
        }
        // One INSERT ... RETURNING for the whole class instead of N
        // sequential creates (same fix as create() above).
        const rows = await tx.attendance_records.createManyAndReturn({
          data: dto.records.map((r) => ({
            student_id: r.student_id,
            class_id: classId,
            subject_id: dto.subject_id,
            attendance_date: attendanceDate,
            status: r.status,
            marked_by_faculty_id: faculty.id,
            marked_by_user_id: userId,
          })),
          select: { id: true },
        });
        // is_published is a real DB column not declared in schema.prisma
        // (not to be touched) — set it via raw SQL in the same transaction
        // as the inserts above. NOTE: photo_url does not actually exist on
        // this table in the live DB (confirmed via \d attendance_records) —
        // dto.photo_url is accepted by the DTO but has nowhere to be
        // persisted; silently dropped rather than crashing every save.
        const ids = rows.map((r) => r.id);
        if (ids.length > 0) {
          await tx.$executeRaw`UPDATE attendance_records SET is_published = false, published_at = NULL WHERE id = ANY(${ids})`;
          if (periodNumber !== 1) {
            try {
              await tx.$executeRaw`UPDATE attendance_records SET period_number = ${periodNumber} WHERE id = ANY(${ids})`;
            } catch (err) {
              if (!isUndefinedColumnError(err, 'period_number')) throw err;
            }
          }
        }
        return rows;
      });
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException({
          message:
            'Attendance has already been marked for this class, subject, and date',
          errorCode: 'ATTENDANCE_ALREADY_MARKED',
        });
      }
      this.logger.error('Bulk class attendance transaction failed', err);
      throw err;
    }

    this.logger.log(
      `Class attendance saved as draft: class=${classId} subject=${dto.subject_id} date=${dto.attendance_date} marked=${created.length}`,
    );

    return {
      class_id: classId,
      attendance_date: dto.attendance_date,
      marked: created.length,
      is_published: false,
    };
  }

  /**
   * POST /me/classes/:class_id/attendance/publish — Faculty only. Flips the
   * draft rows saved by markForClass to is_published=true, the exact moment
   * this attendance becomes visible to students/parents/advisors via
   * GET /attendance (see applyRoleScoping's is_published gate below).
   */
  async publishForClass(
    classId: number,
    subjectId: number,
    attendanceDateIso: string,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const attendanceDate = new Date(attendanceDateIso);

    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: {
        faculty_id: faculty.id,
        subject_id: subjectId,
        class_id: classId,
      },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: 'You are not assigned to teach this subject for this class',
        errorCode: 'NOT_MAPPED_TO_TEACH',
      });
    }

    const allRows = await this.prisma.attendance_records.findMany({
      where: {
        class_id: classId,
        subject_id: subjectId,
        attendance_date: attendanceDate,
      },
      select: { id: true },
    });
    const publishState = await this.rawGetPublishStateByIds(
      allRows.map((r) => r.id),
    );
    const draftIds = allRows
      .map((r) => r.id)
      .filter((id) => !publishState.get(id)?.is_published);
    if (draftIds.length === 0) {
      throw new NotFoundException({
        message:
          'No draft attendance found for this class, subject, and date — save it first',
        errorCode: 'ATTENDANCE_DRAFT_NOT_FOUND',
      });
    }

    const publishedAt = new Date();
    await this.rawSetIsPublished(draftIds, true, publishedAt);
    const draft = draftIds;

    this.logger.log(
      `Class attendance published: class=${classId} subject=${subjectId} date=${attendanceDateIso} count=${draft.length}`,
    );

    return {
      class_id: classId,
      subject_id: subjectId,
      attendance_date: attendanceDateIso,
      published: draft.length,
      published_at: publishedAt.toISOString(),
    };
  }

  /**
   * POST /me/classes/:class_id/attendance/submit-for-review — Faculty only.
   * The optional, additive alternative to calling Publish directly: marks a
   * saved draft as awaiting the Class Advisor's (or HoD's) sign-off, via
   * reviewForClass() below, instead of going straight to students/parents.
   * publishForClass() itself is untouched — a faculty member who doesn't use
   * this can still publish immediately exactly as before.
   */
  async submitForReview(
    classId: number,
    subjectId: number,
    attendanceDateIso: string,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const attendanceDate = new Date(attendanceDateIso);

    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: { faculty_id: faculty.id, subject_id: subjectId, class_id: classId },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: 'You are not assigned to teach this subject for this class',
        errorCode: 'NOT_MAPPED_TO_TEACH',
      });
    }

    const allRows = await this.prisma.attendance_records.findMany({
      where: { class_id: classId, subject_id: subjectId, attendance_date: attendanceDate },
      select: { id: true },
    });
    const publishState = await this.rawGetPublishStateByIds(allRows.map((r) => r.id));
    const draftIds = allRows.map((r) => r.id).filter((id) => !publishState.get(id)?.is_published);
    if (draftIds.length === 0) {
      throw new NotFoundException({
        message: 'No draft attendance found for this class, subject, and date — save it first',
        errorCode: 'ATTENDANCE_DRAFT_NOT_FOUND',
      });
    }

    await this.rawSetSubmittedForReview(draftIds);

    return {
      class_id: classId,
      subject_id: subjectId,
      attendance_date: attendanceDateIso,
      submitted: draftIds.length,
    };
  }

  /**
   * POST /me/classes/:class_id/attendance/review — Class Advisor (via
   * class_mentors, the same mentor-of-class concept student-ods/campus-
   * outing already gate on) or HoD of the class's department. Requires
   * submitForReview() to have been called first; 'approve' is exactly
   * publishForClass()'s effect plus reviewed_by_user_id, 'send_back' clears
   * the submitted flag so the marking faculty can re-edit and resubmit.
   */
  async reviewForClass(
    classId: number,
    subjectId: number,
    attendanceDateIso: string,
    decision: 'approve' | 'send_back',
    reviewer: JwtPayload,
  ) {
    const reviewerUserId = reviewer.sub;
    await this.assertCanReviewClass(classId, reviewer);
    const attendanceDate = new Date(attendanceDateIso);

    const allRows = await this.prisma.attendance_records.findMany({
      where: { class_id: classId, subject_id: subjectId, attendance_date: attendanceDate },
      select: { id: true },
    });
    const ids = allRows.map((r) => r.id);
    const reviewState = await this.rawGetReviewStateByIds(ids);
    const submittedIds = ids.filter((id) => reviewState.get(id)?.submitted_for_review_at != null);
    if (submittedIds.length === 0) {
      throw new NotFoundException({
        message: 'No attendance submitted for review for this class, subject, and date',
        errorCode: 'ATTENDANCE_NOT_SUBMITTED',
      });
    }

    if (decision === 'approve') {
      const publishedAt = new Date();
      await this.rawApproveReview(submittedIds, reviewerUserId, publishedAt);
      return {
        class_id: classId,
        subject_id: subjectId,
        attendance_date: attendanceDateIso,
        decision,
        published: submittedIds.length,
        published_at: publishedAt.toISOString(),
      };
    }

    await this.rawSendBackReview(submittedIds);
    return {
      class_id: classId,
      subject_id: subjectId,
      attendance_date: attendanceDateIso,
      decision,
      sent_back: submittedIds.length,
    };
  }

  /** The class's assigned Class Advisor (class_mentors — any academic_year, same lookup student-ods/campus-outing use) or the HoD of its department may review. Role-gated: only a caller whose JWT role is actually HOD can satisfy the department check, so a same-department FACULTY member who isn't the mentor can't impersonate the HoD. */
  private async assertCanReviewClass(classId: number, reviewer: JwtPayload) {
    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true },
    });
    if (!klass) {
      throw new NotFoundException({ message: 'Class not found', errorCode: 'CLASS_NOT_FOUND' });
    }

    if (reviewer.role === ROLES.HOD) {
      const departmentId = await this.resolveDepartmentIdForHod(reviewer.sub);
      if (departmentId === klass.department_id) return;
    } else {
      const faculty = await this.prisma.faculty.findUnique({
        where: { user_id: reviewer.sub },
        select: { id: true },
      });
      if (faculty) {
        const mentor = await this.prisma.class_mentors.findFirst({
          where: { class_id: classId, faculty_id: faculty.id },
        });
        if (mentor) return;
      }
    }

    throw new ForbiddenException({
      message: 'You are not the Class Advisor for this class or the HoD of its department',
      errorCode: 'NOT_AUTHORIZED_TO_REVIEW',
    });
  }

  /**
   * GET /me/attendance-reviews — the caller's own review queue: every
   * (class, subject, date) session submitted for review and not yet
   * approved, scoped to classes they mentor (class_mentors) plus, for a
   * HOD, every class in their own department. Returns one row per distinct
   * session rather than per attendance_record — a class of 60 students
   * submitted once is one thing to review, not 60.
   */
  async listPendingReviews(reviewer: JwtPayload) {
    let classIds: number[];
    if (reviewer.role === ROLES.HOD) {
      const departmentId = await this.resolveDepartmentIdForHod(reviewer.sub);
      const classes = await this.prisma.classes.findMany({
        where: { department_id: departmentId },
        select: { id: true },
      });
      classIds = classes.map((c) => c.id);
    } else {
      const faculty = await this.prisma.faculty.findUnique({
        where: { user_id: reviewer.sub },
        select: { id: true },
      });
      if (!faculty) return [];
      const mentored = await this.prisma.class_mentors.findMany({
        where: { faculty_id: faculty.id },
        select: { class_id: true },
      });
      classIds = mentored.map((m) => m.class_id);
    }
    if (classIds.length === 0) return [];

    try {
      return await this.prisma.$queryRaw<
        {
          class_id: number;
          subject_id: number;
          attendance_date: Date;
          submitted_for_review_at: Date;
          record_count: bigint;
          class_section: string;
          department_code: string;
          subject_name: string;
          subject_code: string;
        }[]
      >`
        SELECT ar.class_id, ar.subject_id, ar.attendance_date, ar.submitted_for_review_at,
               COUNT(*) AS record_count, cl.section AS class_section, dep.code AS department_code,
               sub.name AS subject_name, sub.subject_code AS subject_code
        FROM attendance_records ar
        JOIN classes cl ON cl.id = ar.class_id
        JOIN departments dep ON dep.id = cl.department_id
        JOIN subjects sub ON sub.id = ar.subject_id
        WHERE ar.submitted_for_review_at IS NOT NULL AND ar.is_published = false
          AND ar.class_id = ANY(${classIds})
        GROUP BY ar.class_id, ar.subject_id, ar.attendance_date, ar.submitted_for_review_at,
                 cl.section, dep.code, sub.name, sub.subject_code
        ORDER BY ar.submitted_for_review_at ASC
      `.then((rows) =>
        rows.map((r) => ({
          class_id: r.class_id,
          subject_id: r.subject_id,
          attendance_date: r.attendance_date.toISOString().slice(0, 10),
          submitted_for_review_at: r.submitted_for_review_at.toISOString(),
          record_count: Number(r.record_count),
          class_section: r.class_section,
          department_code: r.department_code,
          subject_name: r.subject_name,
          subject_code: r.subject_code,
        })),
      );
    } catch (err) {
      if (isUndefinedColumnError(err, 'submitted_for_review_at')) return [];
      throw err;
    }
  }

  /**
   * GET /me/classes/:class_id/attendance/draft?subject_id=&date= — Faculty
   * only. Lets the marking screen re-hydrate an unpublished draft so Save
   * can be clicked, the page refreshed, and the same draft continued before
   * Publish — without this, a draft saved once could never be re-opened.
   */
  async getDraftForClass(
    classId: number,
    subjectId: number,
    dateIso: string,
    userId: number,
    periodNumber = 1,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: {
        faculty_id: faculty.id,
        subject_id: subjectId,
        class_id: classId,
      },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: 'You are not assigned to teach this subject for this class',
        errorCode: 'NOT_MAPPED_TO_TEACH',
      });
    }

    const attendanceDate = new Date(dateIso);
    // See attendance_periods.query.md (Domain 06 checklist item A0) — scoped
    // to this exact period so a 2-period subject's periods can each be
    // re-opened independently; falls back to the old whole-day scope
    // pre-migration (identical to today's behavior).
    const rowIds = await this.rawFindIdsForPeriod(
      classId,
      subjectId,
      attendanceDate,
      periodNumber,
    );
    const rows =
      rowIds.length > 0
        ? await this.prisma.attendance_records.findMany({
            where: { id: { in: rowIds } },
            select: { id: true, student_id: true, status: true },
          })
        : [];
    const publishState = await this.rawGetPublishState(
      classId,
      subjectId,
      attendanceDate,
      periodNumber,
    );
    const reviewState = await this.rawGetReviewStateByIds(rows.map((r) => r.id));

    return {
      class_id: classId,
      subject_id: subjectId,
      attendance_date: dateIso,
      is_published:
        publishState.length > 0 && publishState.every((r) => r.is_published),
      submitted_for_review: rows.some(
        (r) => reviewState.get(r.id)?.submitted_for_review_at != null,
      ),
      records: rows.map((r) => ({
        student_id: r.student_id,
        status: r.status,
      })),
    };
  }

  /** GET /attendance (Admin/HoD/Faculty/Student/Parent) — filtered, paginated, role-scoped. */
  async findAll(query: ListAttendanceQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      class_id: query.class_id,
      student_id: query.student_id,
    };

    if (query.date) {
      where.attendance_date = new Date(query.date);
    } else if (query.from_date ?? query.to_date) {
      where.attendance_date = {
        ...(query.from_date && { gte: new Date(query.from_date) }),
        ...(query.to_date && { lte: new Date(query.to_date) }),
      };
    }

    await this.applyRoleScoping(where, currentUser, query.student_id);

    // is_published isn't a schema.prisma field — for STUDENT/PARENT, resolve
    // the set of published ids via raw SQL first and constrain the typed
    // query to just those, instead of filtering in the where clause itself.
    // Scoped by student_id (now resolved by applyRoleScoping above) so this
    // is an indexed per-student/per-children lookup instead of a full scan
    // of every published attendance record institution-wide.
    if (
      currentUser.role === ROLES.STUDENT ||
      currentUser.role === ROLES.PARENT
    ) {
      const studentIdFilter = where.student_id;
      const publishedIds =
        typeof studentIdFilter === 'number'
          ? await this.prisma.$queryRaw<
              { id: number }[]
            >`SELECT id FROM attendance_records WHERE is_published = true AND student_id = ${studentIdFilter}`
          : await this.prisma.$queryRaw<
              { id: number }[]
            >`SELECT id FROM attendance_records WHERE is_published = true AND student_id = ANY(${(studentIdFilter as { in: number[] }).in})`;
      where.id = { in: publishedIds.map((r) => r.id) };
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.attendance_records.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { attendance_date: 'desc' },
        select: ATTENDANCE_SELECT,
      }),
      this.prisma.attendance_records.count({ where }),
    ]);

    const publishState = await this.rawGetPublishStateByIds(
      rows.map((r) => r.id),
    );
    return paginate(
      rows.map((r) => toResponse(r, publishState.get(r.id))),
      total,
      query,
    );
  }

  /** GET /attendance/:id (Admin/HoD/Faculty/Student/Parent) — role-scoped. */
  async findOne(id: number, currentUser: JwtPayload) {
    const record = await this.prisma.attendance_records.findUnique({
      where: { id },
      select: ATTENDANCE_SELECT,
    });

    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }

    await this.assertCanViewStudent(record.students.id, currentUser);

    const [publishState] = await this.rawGetPublishStateByIds([id]).then(
      (m) => [m.get(id)],
    );

    if (
      (currentUser.role === ROLES.STUDENT ||
        currentUser.role === ROLES.PARENT) &&
      !publishState?.is_published
    ) {
      throw new NotFoundException('Attendance record not found');
    }

    return toResponse(record, publishState);
  }

  /**
   * PATCH /attendance/:id (Faculty / Secretary — only the one who marked it).
   * `status` is the only editable field. Ownership is checked against the
   * generic `marked_by_user_id` rather than the faculty-only column, so it
   * works the same way regardless of which role created the record.
   */
  async update(id: number, dto: UpdateAttendanceDto, userId: number) {
    const record = await this.prisma.attendance_records.findUnique({
      where: { id },
    });
    if (!record) {
      throw new NotFoundException('Attendance record not found');
    }

    if (record.marked_by_user_id !== userId) {
      throw new ForbiddenException(
        'You may only edit attendance records you marked yourself',
      );
    }

    // is_published is a raw column, not a schema.prisma field (see this
    // file's own rawGetPublishState* helpers) — publish is meant to be
    // final (matches Subject Records marks locking after publish), so this
    // must be checked via raw SQL rather than a typed Prisma read.
    const [publishState] = await this.rawGetPublishStateByIds([id]).then(
      (m) => [m.get(id)],
    );
    if (publishState?.is_published) {
      throw new ConflictException({
        message:
          'This attendance record has already been published and can no longer be edited',
        errorCode: 'ATTENDANCE_ALREADY_PUBLISHED',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.attendance_record_changes.create({
        data: {
          attendance_record_id: id,
          from_status: record.status,
          to_status: dto.status,
          changed_by_user_id: userId,
        },
      });
      return tx.attendance_records.update({
        where: { id },
        data: { status: dto.status },
        select: ATTENDANCE_SELECT,
      });
    });

    return toResponse(updated);
  }

  /**
   * GET /me/classes/:class_id/roster (Faculty / Secretary).
   *
   * The roster a "mark attendance" screen needs before it can render one row
   * per student — admissions/students has no working list endpoint of its
   * own to serve this, so it lives here instead, scoped to exactly what
   * attendance-marking needs (id, roll number, name), not a general-purpose
   * student listing. Only active students are included; a student who has
   * left doesn't need attendance marked against them.
   */
  async getClassRoster(classId: number) {
    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
    });
    if (!klass) {
      throw new NotFoundException({
        message: 'Class not found',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }

    const students = await this.prisma.students.findMany({
      where: { class_id: classId, status: 'active' },
      select: {
        id: true,
        student_id_no: true,
        roll_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
      },
      orderBy: { roll_no: 'asc' },
    });

    return students.map((s) => ({
      id: s.id,
      student_id_no: s.student_id_no,
      roll_no: s.roll_no,
      first_name: s.soa_applications?.first_name ?? null,
      last_name: s.soa_applications?.last_name ?? null,
    }));
  }

  /**
   * Rejects marking attendance on a date the academic calendar has declared
   * a holiday for this class's batch/semester. Best-effort: if no matching
   * academic_calendars row exists yet for this batch+semester, there's
   * nothing to check against, so marking proceeds rather than blocking on
   * an incomplete calendar setup.
   */
  private async assertNotHoliday(
    batchId: number,
    currentSemester: number | null,
    attendanceDate: Date,
  ) {
    if (currentSemester === null) return;
    const calendar = await this.prisma.academic_calendars.findFirst({
      where: { batch_id: batchId, semester: currentSemester },
      select: { id: true },
    });
    if (!calendar) return;

    const holiday = await this.prisma.calendar_events.findFirst({
      where: {
        academic_calendar_id: calendar.id,
        event_date: attendanceDate,
        event_type: 'holiday',
      },
      select: { title: true },
    });
    if (holiday) {
      throw new ConflictException({
        message: `${attendanceDate.toDateString()} is a declared holiday (${holiday.title}) — attendance cannot be marked on this date.`,
        errorCode: 'ATTENDANCE_ON_HOLIDAY',
      });
    }
  }

  private async resolveFacultyByUserId(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  /**
   * HOD's own faculty row is the only honest source of their department —
   * never trust a client-supplied department_id. Same convention already
   * used correctly by hod-class-records.service.ts/hod-faculty-staff.service.ts.
   */
  private async resolveDepartmentIdForHod(userId: number): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty.department_id;
  }

  /**
   * STUDENT and PARENT are restricted to their own (or their children's) records —
   * workflow.md scopes both roles to "their own"/"their son/daughter" explicitly.
   * HOD is restricted to their own department (see resolveDepartmentIdForHod).
   * ADMIN and SECRETARY remain institution-wide (staff-tier access, matching
   * how the Faculty and Faculty Mapping modules treat those roles elsewhere).
   */
  private async applyRoleScoping(
    where: Record<string, unknown>,
    user: JwtPayload,
    requestedStudentId?: number,
  ) {
    // Drafts (is_published=false, saved via POST /me/classes/:id/attendance
    // before Publish) are only visible to staff (admin/hod/faculty) who can
    // see their own in-progress marking; students/parents only ever see
    // published attendance — the raw-SQL `where.id` publish-gate is applied
    // in findAll() above (is_published is a raw column, not a schema.prisma
    // field, so it can't be filtered directly in this Prisma where clause).
    if (user.role === ROLES.HOD) {
      const departmentId = await this.resolveDepartmentIdForHod(user.sub);
      const requestedClassId = where.class_id as number | undefined;
      if (requestedClassId !== undefined) {
        const klass = await this.prisma.classes.findUnique({
          where: { id: requestedClassId },
          select: { department_id: true },
        });
        if (!klass || klass.department_id !== departmentId) {
          throw new ForbiddenException(
            'You may only view attendance records for classes in your own department',
          );
        }
      }
      where.classes = { department_id: departmentId };
    } else if (user.role === ROLES.STUDENT) {
      const student = await this.prisma.students.findUnique({
        where: { user_id: user.sub },
      });
      if (!student) {
        throw new NotFoundException(
          'Student profile not found for the authenticated user',
        );
      }
      if (
        requestedStudentId !== undefined &&
        requestedStudentId !== student.id
      ) {
        throw new ForbiddenException(
          'You may only view your own attendance records',
        );
      }
      where.student_id = student.id;
    } else if (user.role === ROLES.PARENT) {
      const mappings = await this.prisma.parent_student_mapping.findMany({
        where: { parent_user_id: user.sub },
        select: { student_id: true },
      });
      const childIds = mappings.map((m) => m.student_id);

      if (requestedStudentId !== undefined) {
        if (!childIds.includes(requestedStudentId)) {
          throw new ForbiddenException(
            'You may only view attendance records of your own children',
          );
        }
        where.student_id = requestedStudentId;
      } else {
        where.student_id = { in: childIds };
      }
    }
  }

  private async assertCanViewStudent(studentId: number, user: JwtPayload) {
    if (user.role === ROLES.HOD) {
      const departmentId = await this.resolveDepartmentIdForHod(user.sub);
      const student = await this.prisma.students.findUnique({
        where: { id: studentId },
        select: { classes: { select: { department_id: true } } },
      });
      if (!student?.classes || student.classes.department_id !== departmentId) {
        throw new ForbiddenException(
          'You may only view attendance records for students in your own department',
        );
      }
    } else if (user.role === ROLES.STUDENT) {
      const student = await this.prisma.students.findUnique({
        where: { user_id: user.sub },
      });
      if (!student || student.id !== studentId) {
        throw new ForbiddenException(
          'You may only view your own attendance records',
        );
      }
    } else if (user.role === ROLES.PARENT) {
      const mapping = await this.prisma.parent_student_mapping.findFirst({
        where: { parent_user_id: user.sub, student_id: studentId },
      });
      if (!mapping) {
        throw new ForbiddenException(
          'You may only view attendance records of your own children',
        );
      }
    }
  }
}
