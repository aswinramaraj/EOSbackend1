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
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { isUndefinedTableError } from 'src/common/utils/pg-error.util';
import { CreateTakeoverRequestDto } from './dto/create-takeover-request.dto';
import { CreateSwapRequestDto } from './dto/create-swap-request.dto';
import { RespondPeriodRequestDto } from './dto/respond-period-request.dto';

const TABLE = 'timetable_period_requests';

/**
 * This module's one established day_of_week convention: 1=Monday..6=Saturday,
 * never 0/7. Exported so TimetableService's findTodayForFaculty/
 * computeTimetableForStudent use this exact same mapping when resolving an
 * arbitrary given date, instead of a second, subtly different helper.
 */
export function dayOfWeekOf(dateIso: string): number {
  const jsDay = new Date(`${dateIso}T00:00:00Z`).getUTCDay(); // 0=Sun..6=Sat
  return jsDay === 0 ? 7 : jsDay; // Sunday maps to 7, which never matches any real slot — deliberately invalid rather than silently aliased to Monday.
}

interface SlotFacts {
  id: number;
  day_of_week: number;
  period_number: number;
  class_id: number;
  faculty_id: number;
  subject_id: number;
  academic_year: string;
  semester: number;
}

interface PeriodRequestRow {
  id: number;
  request_type: 'takeover' | 'swap';
  request_date: Date;
  class_id: number;
  from_faculty_id: number;
  to_faculty_id: number;
  primary_slot_id: number;
  secondary_slot_id: number | null;
  covering_subject_id: number | null;
  status: 'pending' | 'accepted' | 'rejected' | 'cancelled';
  created_at: Date;
  decided_at: Date | null;
  from_faculty_first_name: string;
  from_faculty_last_name: string;
  to_faculty_first_name: string;
  to_faculty_last_name: string;
  class_section: string;
  class_department_code: string;
  class_department_name: string;
  class_semester: number | null;
  primary_period_number: number;
  primary_start_time: Date;
  primary_end_time: Date;
  primary_subject_id: number;
  primary_subject_name: string;
  primary_subject_code: string;
  secondary_period_number: number | null;
  secondary_start_time: Date | null;
  secondary_end_time: Date | null;
  secondary_subject_id: number | null;
  secondary_subject_name: string | null;
  secondary_subject_code: string | null;
  secondary_class_id: number | null;
  secondary_class_section: string | null;
  secondary_class_department_code: string | null;
  secondary_class_department_name: string | null;
  secondary_class_semester: number | null;
  covering_subject_name: string | null;
  covering_subject_code: string | null;
}

function facultyName(first: string, last: string): string {
  return `${first} ${last}`.trim();
}

function toResponse(r: PeriodRequestRow) {
  return {
    id: r.id,
    request_type: r.request_type,
    request_date: r.request_date.toISOString().slice(0, 10),
    status: r.status,
    class: {
      id: r.class_id,
      section: r.class_section,
      department_code: r.class_department_code,
      department_name: r.class_department_name,
      semester: r.class_semester,
    },
    from_faculty: {
      id: r.from_faculty_id,
      name: facultyName(r.from_faculty_first_name, r.from_faculty_last_name),
    },
    to_faculty: {
      id: r.to_faculty_id,
      name: facultyName(r.to_faculty_first_name, r.to_faculty_last_name),
    },
    primary_period: {
      slot_id: r.primary_slot_id,
      period_number: r.primary_period_number,
      start_time: r.primary_start_time.toISOString().slice(11, 16),
      end_time: r.primary_end_time.toISOString().slice(11, 16),
      subject: {
        id: r.primary_subject_id,
        name: r.primary_subject_name,
        code: r.primary_subject_code,
      },
    },
    secondary_period:
      r.secondary_slot_id != null
        ? {
            slot_id: r.secondary_slot_id,
            period_number: r.secondary_period_number,
            start_time:
              r.secondary_start_time?.toISOString().slice(11, 16) ?? null,
            end_time: r.secondary_end_time?.toISOString().slice(11, 16) ?? null,
            class_id: r.secondary_class_id,
            class_section: r.secondary_class_section,
            class_department_code: r.secondary_class_department_code,
            class_department_name: r.secondary_class_department_name,
            class_semester: r.secondary_class_semester,
            subject:
              r.secondary_subject_name != null && r.secondary_subject_id != null
                ? {
                    id: r.secondary_subject_id,
                    name: r.secondary_subject_name,
                    // The LEFT JOIN to `subjects` either matches fully or not
                    // at all — subject_code can't be null when name isn't.
                    code: r.secondary_subject_code as string,
                  }
                : null,
          }
        : null,
    covering_subject:
      r.covering_subject_id != null
        ? {
            id: r.covering_subject_id,
            // Same reasoning as secondary_period.subject above — the FK is
            // set, so the LEFT JOIN to `subjects` always matched.
            name: r.covering_subject_name as string,
            code: r.covering_subject_code as string,
          }
        : null,
    created_at: r.created_at,
    decided_at: r.decided_at,
  };
}

/**
 * Real once `timetable_period_requests` runs (see
 * timetable_period_requests.query.md) — a brand-new table, not an additive
 * column, so there's no "old behavior" to fall back to. Reads degrade to an
 * honest empty result; writes throw a clear FEATURE_NOT_ENABLED error,
 * until the migration lands.
 */
@Injectable()
export class TimetablePeriodRequestsService {
  private readonly logger = new Logger(TimetablePeriodRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  async createTakeover(userId: number, dto: CreateTakeoverRequestDto) {
    const fromFaculty = await this.resolveFacultyByUserId(userId);
    const primarySlot = await this.loadSlot(dto.primary_slot_id);

    if (primarySlot.faculty_id !== fromFaculty.id) {
      throw new ForbiddenException({
        message: 'You can only request coverage for your own period.',
        errorCode: 'NOT_YOUR_SLOT',
      });
    }
    if (dto.to_faculty_id === fromFaculty.id) {
      throw new BadRequestException(
        'You cannot request coverage from yourself.',
      );
    }
    this.assertDateMatchesSlotDay(dto.request_date, primarySlot);
    await this.assertFacultyExists(dto.to_faculty_id);
    await this.assertNoConflictingRequest(
      dto.primary_slot_id,
      dto.request_date,
    );

    const row = await this.insert({
      request_type: 'takeover',
      request_date: dto.request_date,
      class_id: primarySlot.class_id,
      from_faculty_id: fromFaculty.id,
      to_faculty_id: dto.to_faculty_id,
      primary_slot_id: dto.primary_slot_id,
      secondary_slot_id: null,
    });

    await this.notifyRequestCreated(row, primarySlot);
    return toResponse(row);
  }

  async createSwap(userId: number, dto: CreateSwapRequestDto) {
    const fromFaculty = await this.resolveFacultyByUserId(userId);
    const primarySlot = await this.loadSlot(dto.primary_slot_id);
    const secondarySlot = await this.loadSlot(dto.secondary_slot_id);

    if (primarySlot.faculty_id !== fromFaculty.id) {
      throw new ForbiddenException({
        message: 'You can only offer your own period for a swap.',
        errorCode: 'NOT_YOUR_SLOT',
      });
    }
    if (secondarySlot.faculty_id === fromFaculty.id) {
      throw new BadRequestException(
        'Pick a period taught by a different faculty member to swap with.',
      );
    }
    this.assertDateMatchesSlotDay(dto.request_date, primarySlot);
    this.assertDateMatchesSlotDay(dto.request_date, secondarySlot);
    await this.assertNoConflictingRequest(
      dto.primary_slot_id,
      dto.request_date,
    );
    await this.assertNoConflictingRequest(
      dto.secondary_slot_id,
      dto.request_date,
    );

    const row = await this.insert({
      request_type: 'swap',
      request_date: dto.request_date,
      class_id: primarySlot.class_id,
      from_faculty_id: fromFaculty.id,
      to_faculty_id: secondarySlot.faculty_id,
      primary_slot_id: dto.primary_slot_id,
      secondary_slot_id: dto.secondary_slot_id,
    });

    await this.notifyRequestCreated(row, primarySlot);
    return toResponse(row);
  }

  /** GET /me/timetable-requests — both directions, most recent first. */
  async listMine(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    try {
      const rows = await this.queryRows(
        `WHERE (r.from_faculty_id = $1 OR r.to_faculty_id = $1) ORDER BY r.created_at DESC LIMIT 200`,
        [faculty.id],
      );
      const mapped = rows.map(toResponse);
      return {
        sent: mapped.filter((r) => r.from_faculty.id === faculty.id),
        received: mapped.filter((r) => r.to_faculty.id === faculty.id),
      };
    } catch (err) {
      if (isUndefinedTableError(err, TABLE)) return { sent: [], received: [] };
      throw err;
    }
  }

  /** PATCH /me/timetable-requests/:id/respond (the covering faculty only). */
  async respond(
    userId: number,
    requestId: number,
    dto: RespondPeriodRequestDto,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const existing = await this.loadRequestRow(requestId);

    if (existing.to_faculty_id !== faculty.id) {
      throw new ForbiddenException({
        message: 'Only the faculty this request was sent to may respond.',
        errorCode: 'NOT_YOUR_REQUEST',
      });
    }
    if (existing.status !== 'pending') {
      throw new ConflictException({
        message: 'This request has already been decided.',
        errorCode: 'ALREADY_DECIDED',
      });
    }

    const coveringSubjectId =
      existing.request_type === 'takeover' && dto.decision === 'accepted'
        ? (dto.covering_subject_id ?? null)
        : null;

    try {
      await this.prisma.$executeRawUnsafe(
        `UPDATE ${TABLE} SET status = $1, decided_at = now(), decided_by_user_id = $2, covering_subject_id = $3 WHERE id = $4`,
        dto.decision,
        userId,
        coveringSubjectId,
        requestId,
      );
    } catch (err) {
      if (isUndefinedTableError(err, TABLE)) {
        throw new UnprocessableEntityException({
          message: 'This feature is not enabled yet.',
          errorCode: 'FEATURE_NOT_ENABLED',
        });
      }
      throw err;
    }

    const updated = await this.loadRequestRow(requestId);
    await this.notifyRequestDecided(updated);
    return toResponse(updated);
  }

  /** DELETE /me/timetable-requests/:id — the requester withdrawing their own still-pending request. */
  async cancel(userId: number, requestId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const existing = await this.loadRequestRow(requestId);

    if (existing.from_faculty_id !== faculty.id) {
      throw new ForbiddenException({
        message: 'You can only cancel a request you sent.',
        errorCode: 'NOT_YOUR_REQUEST',
      });
    }
    if (existing.status !== 'pending') {
      throw new ConflictException({
        message:
          'This request has already been decided and can no longer be cancelled.',
        errorCode: 'ALREADY_DECIDED',
      });
    }

    await this.prisma.$executeRawUnsafe(
      `UPDATE ${TABLE} SET status = 'cancelled', decided_at = now(), decided_by_user_id = $1 WHERE id = $2`,
      userId,
      requestId,
    );
    return { id: requestId, status: 'cancelled' as const };
  }

  /**
   * GET /me/timetable-requests/colleagues?date=... — powers the take-over/
   * swap request-creation picker. Scoped to the caller's own department
   * (re-derived from their own faculty row, same convention as every other
   * HoD/department-scoped read in this codebase) since a real take-over/swap
   * happens within a department in practice, and there is otherwise no
   * faculty-accessible endpoint at all that can list another faculty
   * member's id, let alone their schedule. Each colleague's own periods for
   * that exact date are embedded so the same response can drive both the
   * take-over picker (just needs a name) and the swap picker (needs a real
   * slot_id to offer as secondary_slot_id) without a second round trip.
   */
  async listColleaguesForDate(userId: number, dateIso: string) {
    const me = await this.resolveFacultyByUserId(userId);
    const dayOfWeek = dayOfWeekOf(dateIso);

    const colleagues = await this.prisma.faculty.findMany({
      where: {
        department_id: me.department_id,
        status: 'active',
        id: { not: me.id },
      },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        designation: true,
        profile_url: true,
      },
      orderBy: [{ first_name: 'asc' }, { last_name: 'asc' }],
    });
    if (colleagues.length === 0) return [];

    const slots = await this.prisma.timetable_slots.findMany({
      where: {
        faculty_id: { in: colleagues.map((c) => c.id) },
        day_of_week: dayOfWeek,
      },
      select: {
        id: true,
        faculty_id: true,
        period_number: true,
        start_time: true,
        end_time: true,
        subjects: { select: { id: true, name: true, subject_code: true } },
        classes: {
          select: {
            id: true,
            section: true,
            current_semester: true,
            departments: { select: { code: true, name: true } },
          },
        },
      },
      orderBy: { period_number: 'asc' },
    });

    const slotsByFaculty = new Map<number, typeof slots>();
    for (const s of slots) {
      const list = slotsByFaculty.get(s.faculty_id) ?? [];
      list.push(s);
      slotsByFaculty.set(s.faculty_id, list);
    }

    return colleagues.map((c) => ({
      id: c.id,
      name: facultyName(c.first_name, c.last_name),
      designation: c.designation,
      profile_url: c.profile_url,
      periods: (slotsByFaculty.get(c.id) ?? []).map((s) => ({
        slot_id: s.id,
        period_number: s.period_number,
        start_time: s.start_time.toISOString().slice(11, 16),
        end_time: s.end_time.toISOString().slice(11, 16),
        subject: {
          id: s.subjects.id,
          name: s.subjects.name,
          code: s.subjects.subject_code,
        },
        class: {
          id: s.classes.id,
          section: s.classes.section,
          department_code: s.classes.departments.code,
          department_name: s.classes.departments.name,
          semester: s.classes.current_semester,
        },
      })),
    }));
  }

  // ───────────────────────── Overlay resolution (consumed by TimetableService) ─────────────────────────

  /**
   * Every accepted request affecting the given class on the given date, on
   * either side (primary or secondary slot) — used to overlay a class's
   * effective schedule for Student/general timetable reads. Empty array
   * pre-migration, never throws.
   */
  async getAcceptedOverridesForClassDate(classId: number, dateIso: string) {
    try {
      // ss (the secondary slot) is already joined by queryRows() itself —
      // its own class_id covers the case where this class is on the
      // "other side" of a swap, without a second join.
      const rows = await this.queryRows(
        `WHERE r.status = 'accepted' AND r.request_date = $1 AND (r.class_id = $2 OR ss.class_id = $2)`,
        [dateIso, classId],
      );
      return rows.map(toResponse);
    } catch (err) {
      if (isUndefinedTableError(err, TABLE)) return [];
      throw err;
    }
  }

  /**
   * Every accepted request affecting this faculty (either side) on the
   * given date — used to build their own effective personal schedule for
   * the Faculty "Today" view. Empty array pre-migration, never throws.
   */
  async getAcceptedOverridesForFacultyDate(facultyId: number, dateIso: string) {
    try {
      const rows = await this.queryRows(
        `WHERE r.status = 'accepted' AND r.request_date = $1 AND (r.from_faculty_id = $2 OR r.to_faculty_id = $2)`,
        [dateIso, facultyId],
      );
      return rows.map(toResponse);
    } catch (err) {
      if (isUndefinedTableError(err, TABLE)) return [];
      throw err;
    }
  }

  // ───────────────────────── internals ─────────────────────────

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

  private async loadSlot(slotId: number): Promise<SlotFacts> {
    const slot = await this.prisma.timetable_slots.findUnique({
      where: { id: slotId },
      select: {
        id: true,
        day_of_week: true,
        period_number: true,
        class_id: true,
        faculty_id: true,
        subject_id: true,
        academic_year: true,
        semester: true,
      },
    });
    if (!slot) {
      throw new NotFoundException({
        message: 'Timetable period not found.',
        errorCode: 'SLOT_NOT_FOUND',
      });
    }
    return slot;
  }

  private assertDateMatchesSlotDay(dateIso: string, slot: SlotFacts) {
    if (dayOfWeekOf(dateIso) !== slot.day_of_week) {
      throw new BadRequestException({
        message:
          "The selected date doesn't fall on this period's usual weekday.",
        errorCode: 'DATE_WEEKDAY_MISMATCH',
      });
    }
  }

  private async assertFacultyExists(facultyId: number) {
    const exists = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { id: true },
    });
    if (!exists) throw new NotFoundException('Faculty not found');
  }

  /** One real timetable_slots row can only be the subject of one live (pending/accepted) request per date. */
  private async assertNoConflictingRequest(slotId: number, dateIso: string) {
    try {
      const rows = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
        `SELECT id FROM ${TABLE} WHERE request_date = $1 AND status IN ('pending','accepted') AND (primary_slot_id = $2 OR secondary_slot_id = $2) LIMIT 1`,
        dateIso,
        slotId,
      );
      if (rows.length > 0) {
        throw new ConflictException({
          message:
            'This period already has a pending or accepted request for that date.',
          errorCode: 'REQUEST_ALREADY_EXISTS',
        });
      }
    } catch (err) {
      if (isUndefinedTableError(err, TABLE)) return; // nothing to conflict with pre-migration
      throw err;
    }
  }

  private async insert(data: {
    request_type: 'takeover' | 'swap';
    request_date: string;
    class_id: number;
    from_faculty_id: number;
    to_faculty_id: number;
    primary_slot_id: number;
    secondary_slot_id: number | null;
  }): Promise<PeriodRequestRow> {
    try {
      const inserted = await this.prisma.$queryRawUnsafe<{ id: number }[]>(
        `INSERT INTO ${TABLE} (request_type, request_date, class_id, from_faculty_id, to_faculty_id, primary_slot_id, secondary_slot_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        data.request_type,
        data.request_date,
        data.class_id,
        data.from_faculty_id,
        data.to_faculty_id,
        data.primary_slot_id,
        data.secondary_slot_id,
      );
      return await this.loadRequestRow(inserted[0].id);
    } catch (err) {
      if (isUndefinedTableError(err, TABLE)) {
        throw new UnprocessableEntityException({
          message: 'This feature is not enabled yet.',
          errorCode: 'FEATURE_NOT_ENABLED',
        });
      }
      throw err;
    }
  }

  private async loadRequestRow(id: number): Promise<PeriodRequestRow> {
    const rows = await this.queryRows(`WHERE r.id = $1`, [id]);
    if (rows.length === 0) {
      throw new NotFoundException({
        message: 'Request not found.',
        errorCode: 'REQUEST_NOT_FOUND',
      });
    }
    return rows[0];
  }

  /**
   * Shared SELECT powering every read above — one wide query joining every
   * display field needed (faculty names, class label, both slots' real
   * period/time/subject, including the secondary slot's own class_id via
   * `ss`) so callers never need a second round trip or a duplicate join.
   */
  private async queryRows(
    whereClause: string,
    params: unknown[],
  ): Promise<PeriodRequestRow[]> {
    const sql = `
      SELECT
        r.id, r.request_type, r.request_date, r.class_id, r.from_faculty_id, r.to_faculty_id,
        r.primary_slot_id, r.secondary_slot_id, r.covering_subject_id, r.status, r.created_at, r.decided_at,
        ff.first_name AS from_faculty_first_name, ff.last_name AS from_faculty_last_name,
        tf.first_name AS to_faculty_first_name, tf.last_name AS to_faculty_last_name,
        cl.section AS class_section, dep.code AS class_department_code, dep.name AS class_department_name,
        cl.current_semester AS class_semester,
        ps.period_number AS primary_period_number, ps.start_time AS primary_start_time, ps.end_time AS primary_end_time,
        psub.id AS primary_subject_id, psub.name AS primary_subject_name, psub.subject_code AS primary_subject_code,
        ss.period_number AS secondary_period_number, ss.start_time AS secondary_start_time, ss.end_time AS secondary_end_time,
        ssub.id AS secondary_subject_id, ssub.name AS secondary_subject_name, ssub.subject_code AS secondary_subject_code,
        scl.id AS secondary_class_id, scl.section AS secondary_class_section, scl.current_semester AS secondary_class_semester,
        sdep.code AS secondary_class_department_code, sdep.name AS secondary_class_department_name,
        csub.name AS covering_subject_name, csub.subject_code AS covering_subject_code
      FROM ${TABLE} r
      JOIN faculty ff ON ff.id = r.from_faculty_id
      JOIN faculty tf ON tf.id = r.to_faculty_id
      JOIN classes cl ON cl.id = r.class_id
      JOIN departments dep ON dep.id = cl.department_id
      JOIN timetable_slots ps ON ps.id = r.primary_slot_id
      JOIN subjects psub ON psub.id = ps.subject_id
      LEFT JOIN timetable_slots ss ON ss.id = r.secondary_slot_id
      LEFT JOIN subjects ssub ON ssub.id = ss.subject_id
      LEFT JOIN classes scl ON scl.id = ss.class_id
      LEFT JOIN departments sdep ON sdep.id = scl.department_id
      LEFT JOIN subjects csub ON csub.id = r.covering_subject_id
      ${whereClause}
    `;
    return this.prisma.$queryRawUnsafe<PeriodRequestRow[]>(sql, ...params);
  }

  private async notifyRequestCreated(
    row: PeriodRequestRow,
    primarySlot: SlotFacts,
  ) {
    const toUser = await this.prisma.faculty.findUnique({
      where: { id: row.to_faculty_id },
      select: { user_id: true },
    });
    if (!toUser) return;
    const fromName = facultyName(
      row.from_faculty_first_name,
      row.from_faculty_last_name,
    );
    const dateLabel = row.request_date.toISOString().slice(0, 10);
    const message =
      row.request_type === 'takeover'
        ? `${fromName} is requesting you cover period ${primarySlot.period_number} (${row.primary_subject_name}) for ${row.class_section} on ${dateLabel}.`
        : `${fromName} is requesting to swap period ${row.primary_period_number} with your period ${row.secondary_period_number} on ${dateLabel}.`;
    try {
      await this.notifications.notify({
        user_id: toUser.user_id,
        title:
          row.request_type === 'takeover'
            ? 'Period coverage request'
            : 'Period swap request',
        message,
        type: 'approval_request_pending',
        related_entity_type: 'timetable_period_request',
        related_entity_id: row.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify faculty ${row.to_faculty_id} of period request ${row.id}`,
        err,
      );
    }
  }

  private async notifyRequestDecided(row: PeriodRequestRow) {
    const fromUser = await this.prisma.faculty.findUnique({
      where: { id: row.from_faculty_id },
      select: { user_id: true },
    });
    if (!fromUser) return;
    const toName = facultyName(
      row.to_faculty_first_name,
      row.to_faculty_last_name,
    );
    const dateLabel = row.request_date.toISOString().slice(0, 10);
    const verb = row.status === 'accepted' ? 'accepted' : 'declined';
    try {
      await this.notifications.notify({
        user_id: fromUser.user_id,
        title:
          row.request_type === 'takeover'
            ? 'Coverage request updated'
            : 'Swap request updated',
        message: `${toName} has ${verb} your ${row.request_type === 'takeover' ? 'coverage' : 'swap'} request for ${dateLabel}.`,
        type:
          row.status === 'accepted'
            ? 'approval_request_approved'
            : 'approval_request_rejected',
        related_entity_type: 'timetable_period_request',
        related_entity_id: row.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify faculty ${row.from_faculty_id} of decision on request ${row.id}`,
        err,
      );
    }
  }
}
