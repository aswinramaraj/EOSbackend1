import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from 'generated/prisma/client';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import {
  FACULTY_DISPLAY_SELECT,
  FacultyWithDisplay,
  INTERNAL_ERROR,
  resolveFacultyName,
  resolveStudentName,
  STUDENT_DISPLAY_INCLUDE,
  studentAcademicMeta,
} from '../common/sports-common';
import { CreateOdRequestDto } from './dto/create-od-request.dto';
import { SearchOdRequestsDto } from './dto/search-od-requests.dto';

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const OD_REQUEST_INCLUDE = {
  faculty: { select: FACULTY_DISPLAY_SELECT },
  _count: { select: { sports_od_squad_members: true } },
} satisfies Prisma.sports_od_requestsInclude;

type OdRequestWithRelations = Prisma.sports_od_requestsGetPayload<{
  include: typeof OD_REQUEST_INCLUDE;
}>;

const OD_REQUEST_DETAIL_INCLUDE = {
  faculty: { select: FACULTY_DISPLAY_SELECT },
  sports_od_squad_members: {
    select: {
      student_id: true,
      students: { include: STUDENT_DISPLAY_INCLUDE },
    },
  },
  _count: { select: { sports_od_squad_members: true } },
} satisfies Prisma.sports_od_requestsInclude;

type OdRequestWithDetail = Prisma.sports_od_requestsGetPayload<{
  include: typeof OD_REQUEST_DETAIL_INCLUDE;
}>;

function toAccompanyingCoach(faculty: FacultyWithDisplay | null) {
  return faculty ? { id: faculty.id, name: resolveFacultyName(faculty) } : null;
}

function toOdRequestResponse(row: OdRequestWithRelations) {
  return {
    id: row.id,
    od_type: row.od_type,
    event: row.event,
    from_date: toDateOnly(row.from_date),
    to_date: toDateOnly(row.to_date),
    venue: row.venue,
    level: row.level,
    status: row.status,
    squad_size: row._count.sports_od_squad_members,
    accompanying_coach: toAccompanyingCoach(row.faculty),
  };
}

function toOdRequestDetailResponse(row: OdRequestWithDetail) {
  return {
    ...toOdRequestResponse(row),
    squad: row.sports_od_squad_members.map((member) => ({
      student_id: member.student_id,
      name: resolveStudentName(member.students),
      meta: studentAcademicMeta(member.students),
    })),
  };
}

@Injectable()
export class OdService {
  private readonly logger = new Logger(OdService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** GET /sports-admin/od-requests?status= */
  async findAll(dto: SearchOdRequestsDto) {
    const where: Prisma.sports_od_requestsWhereInput = {};
    if (dto.status) where.status = dto.status;

    try {
      const rows = await this.prisma.sports_od_requests.findMany({
        where,
        include: OD_REQUEST_INCLUDE,
        orderBy: { created_at: 'desc' },
      });
      return rows.map(toOdRequestResponse);
    } catch (err) {
      this.logger.error('DB error while fetching OD requests', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * POST /sports-admin/od-requests
   *
   * Error cases:
   *  400 OD_SQUAD_REQUIRED – student_ids is empty
   */
  async create(dto: CreateOdRequestDto, userId: number) {
    if (!dto.student_ids || dto.student_ids.length === 0) {
      throw new BadRequestException({
        message: 'At least one student must be added to the OD squad',
        errorCode: 'OD_SQUAD_REQUIRED',
      });
    }

    let requestId: number;
    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const request = await tx.sports_od_requests.create({
          data: {
            od_type: dto.od_type,
            periods_affected: dto.periods_affected,
            from_date: new Date(dto.from_date),
            to_date: new Date(dto.to_date),
            event: dto.event,
            venue: dto.venue,
            level: dto.level,
            accompanying_coach_faculty_id: dto.accompanying_coach_faculty_id,
            transport: dto.transport,
            remarks: dto.remarks,
            requested_by_user_id: userId,
          },
        });

        await tx.sports_od_squad_members.createMany({
          data: dto.student_ids.map((student_id) => ({
            od_request_id: request.id,
            student_id,
          })),
        });

        // One approval row per department represented in the squad. Done
        // inside the same transaction as the request and its members, so a
        // request can never exist without the approvals that gate it.
        await tx.$executeRaw(Prisma.sql`
          INSERT INTO sports_od_hod_approvals (od_request_id, department_id, hod_user_id)
          SELECT DISTINCT ${request.id}::int, c.department_id, f.user_id
          FROM sports_od_squad_members m
          JOIN students s   ON s.id = m.student_id
          JOIN classes c    ON c.id = s.class_id
          LEFT JOIN departments d ON d.id = c.department_id
          LEFT JOIN faculty f     ON f.id = d.head_of_department_faculty_id
          WHERE m.od_request_id = ${request.id}::int
          ON CONFLICT (od_request_id, department_id) DO NOTHING
        `);

        return request;
      });
      requestId = created.id;
    } catch (err) {
      this.logger.error('DB error while creating OD request', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    // Each department's HoD is told there is an OD waiting on them.
    await this.notifyPendingHods(requestId);

    return this.findOne(requestId);
  }

  /**
   * GET /sports-admin/od-requests/:id
   *
   * Error cases:
   *  404 OD_REQUEST_NOT_FOUND – no OD request with this id
   */
  async findOne(id: number) {
    let row: OdRequestWithDetail | null;
    try {
      row = await this.prisma.sports_od_requests.findUnique({
        where: { id },
        include: OD_REQUEST_DETAIL_INCLUDE,
      });
    } catch (err) {
      this.logger.error('DB error during OD request lookup', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    if (!row) {
      throw new NotFoundException({
        message: 'OD request not found',
        errorCode: 'OD_REQUEST_NOT_FOUND',
      });
    }
    return toOdRequestDetailResponse(row);
  }

  /**
   * POST /sports-admin/od-requests/:id/approve — acted on by an HoD.
   *
   * Sports raises the OD; it is the HoD of each department in the squad who
   * releases their own students. Sports approving its own request was the
   * defect, so there is no longer any sports-side decision path here at all.
   */
  async approve(id: number, userId: number, remarks?: string) {
    return this.decideAsHod(id, 'approved', userId, remarks);
  }

  /** POST /sports-admin/od-requests/:id/reject — same rules as approve. */
  async reject(id: number, userId: number, remarks?: string) {
    return this.decideAsHod(id, 'rejected', userId, remarks);
  }

  /**
   * Records one department's decision, then rolls the request up:
   *   any rejected -> rejected, all approved -> approved, else still pending.
   *
   * The caller may only decide for the department they head, so one HoD cannot
   * release another department's students.
   */
  private async decideAsHod(
    id: number,
    status: 'approved' | 'rejected',
    userId: number,
    remarks?: string,
  ) {
    const departmentIds = await this.departmentsHeadedBy(userId);
    if (departmentIds.length === 0) {
      throw new ForbiddenException({
        message: 'Only the head of a department can decide a sports OD request',
        errorCode: 'OD_NOT_DEPARTMENT_HEAD',
      });
    }

    try {
      const claimed = await this.prisma.$executeRaw(Prisma.sql`
        UPDATE sports_od_hod_approvals
        SET status = ${status}::approval_status_enum,
            reviewed_by_user_id = ${userId},
            reviewed_at = now(),
            remarks = ${remarks ?? null}
        WHERE od_request_id = ${id}
          AND department_id IN (${Prisma.join(departmentIds)})
          AND status = 'pending'
      `);

      if (claimed === 0) {
        // Either there is nothing for this HoD on this request, or they have
        // already decided it. Both are conflicts rather than server faults.
        throw new ConflictException({
          message:
            'There is no pending sports OD approval for your department on this request',
          errorCode: 'OD_APPROVAL_NOT_PENDING',
        });
      }

      await this.rollUpStatus(id, userId);
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      this.logger.error('DB error while deciding OD request', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }

    await this.notifyRequesterOfProgress(id);
    return this.findOne(id);
  }

  /**
   * GET /sports-admin/od-requests/hod-queue?status= — the requests waiting
   * on (or already decided by) the calling HoD's own department(s).
   *
   * Fetches every status in one query and filters/counts in memory — the row
   * volume per HoD's own department(s) is small, and this avoids a second
   * round trip just for the tab counts (same reasoning as the student/faculty
   * OD list's counts).
   */
  async hodQueue(userId: number, status?: 'pending' | 'approved' | 'rejected' | 'all') {
    const departmentIds = await this.departmentsHeadedBy(userId);
    if (departmentIds.length === 0) {
      return { counts: { pending: 0, approved: 0, rejected: 0, all: 0 }, rows: [] };
    }

    try {
      const rows = await this.prisma.$queryRaw<
        {
          od_request_id: number;
          department_id: number;
          department_name: string | null;
          status: string;
          event: string;
          od_type: string;
          from_date: Date;
          to_date: Date;
          venue: string | null;
          level: string | null;
          students_from_my_department: bigint;
        }[]
      >(Prisma.sql`
        SELECT a.od_request_id,
               a.department_id,
               d.name AS department_name,
               a.status::text AS status,
               r.event, r.od_type, r.from_date, r.to_date, r.venue, r.level,
               (
                 SELECT count(*)
                 FROM sports_od_squad_members m
                 JOIN students s ON s.id = m.student_id
                 JOIN classes c  ON c.id = s.class_id
                 WHERE m.od_request_id = r.id AND c.department_id = a.department_id
               ) AS students_from_my_department
        FROM sports_od_hod_approvals a
        JOIN sports_od_requests r ON r.id = a.od_request_id
        LEFT JOIN departments d   ON d.id = a.department_id
        WHERE a.department_id IN (${Prisma.join(departmentIds)})
        ORDER BY r.from_date DESC, r.id DESC
      `);

      const counts = {
        pending: rows.filter((r) => r.status === 'pending').length,
        approved: rows.filter((r) => r.status === 'approved').length,
        rejected: rows.filter((r) => r.status === 'rejected').length,
        all: rows.length,
      };

      const filtered = !status || status === 'all' ? rows : rows.filter((r) => r.status === status);

      return {
        counts,
        rows: filtered.map((r) => ({
          od_request_id: r.od_request_id,
          department_id: r.department_id,
          department_name: r.department_name,
          status: r.status,
          event: r.event,
          od_type: r.od_type,
          from_date: toDateOnly(r.from_date),
          to_date: toDateOnly(r.to_date),
          venue: r.venue,
          level: r.level,
          students_from_my_department: Number(r.students_from_my_department),
        })),
      };
    } catch (err) {
      this.logger.error('DB error while loading HoD OD queue', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** Per-department approval state for one request, for the detail view. */
  async approvals(id: number) {
    try {
      const rows = await this.prisma.$queryRaw<
        {
          department_id: number;
          department_name: string | null;
          status: string;
          reviewed_at: Date | null;
          remarks: string | null;
          student_count: bigint;
        }[]
      >(Prisma.sql`
        SELECT a.department_id,
               d.name AS department_name,
               a.status::text AS status,
               a.reviewed_at,
               a.remarks,
               (
                 SELECT count(*)
                 FROM sports_od_squad_members m
                 JOIN students s ON s.id = m.student_id
                 JOIN classes c  ON c.id = s.class_id
                 WHERE m.od_request_id = a.od_request_id
                   AND c.department_id = a.department_id
               ) AS student_count
        FROM sports_od_hod_approvals a
        LEFT JOIN departments d ON d.id = a.department_id
        WHERE a.od_request_id = ${id}
        ORDER BY d.name ASC NULLS LAST
      `);

      return rows.map((r) => ({
        department_id: r.department_id,
        department_name: r.department_name,
        status: r.status,
        reviewed_at: r.reviewed_at ? r.reviewed_at.toISOString() : null,
        remarks: r.remarks,
        student_count: Number(r.student_count),
      }));
    } catch (err) {
      this.logger.error('DB error while loading OD approvals', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /** Departments whose head_of_department_faculty_id maps to this user. */
  private async departmentsHeadedBy(userId: number): Promise<number[]> {
    try {
      const rows = await this.prisma.departments.findMany({
        where: {
          faculty_departments_head_of_department_faculty_idTofaculty: {
            user_id: userId,
          },
        },
        select: { id: true },
      });
      return rows.map((r) => r.id);
    } catch (err) {
      this.logger.error('DB error resolving departments headed by user', err);
      throw new InternalServerErrorException(INTERNAL_ERROR);
    }
  }

  /**
   * Recomputes the parent request from its department rows. Kept as one
   * statement so a concurrent second HoD decision cannot read a stale tally.
   */
  private async rollUpStatus(id: number, userId: number): Promise<void> {
    await this.prisma.$executeRaw(Prisma.sql`
      UPDATE sports_od_requests r
      SET status = agg.rolled_up,
          -- The casts are load-bearing: in a CASE whose other branch is a bare
          -- NULL, Postgres has nothing to infer a bound parameter's type from
          -- and settles on text, which then fails against these columns.
          reviewed_by_user_id = CASE
                                  WHEN agg.rolled_up <> 'pending' THEN ${userId}::int
                                  ELSE NULL::int
                                END,
          reviewed_at         = CASE
                                  WHEN agg.rolled_up <> 'pending' THEN now()
                                  ELSE NULL::timestamptz
                                END
      FROM (
        SELECT od_request_id,
               CASE
                 WHEN count(*) FILTER (WHERE status = 'rejected') > 0
                   THEN 'rejected'::approval_status_enum
                 WHEN count(*) FILTER (WHERE status <> 'approved') = 0
                   THEN 'approved'::approval_status_enum
                 ELSE 'pending'::approval_status_enum
               END AS rolled_up
        FROM sports_od_hod_approvals
        WHERE od_request_id = ${id}
        GROUP BY od_request_id
      ) agg
      WHERE r.id = agg.od_request_id
    `);
  }

  /**
   * Alerts each department's HoD. Failures are logged and swallowed — the
   * request is already saved and a lost alert must not fail the submission.
   */
  private async notifyPendingHods(requestId: number): Promise<void> {
    try {
      const rows = await this.prisma.$queryRaw<
        { hod_user_id: number | null; department_name: string | null }[]
      >(Prisma.sql`
        SELECT a.hod_user_id, d.name AS department_name
        FROM sports_od_hod_approvals a
        LEFT JOIN departments d ON d.id = a.department_id
        WHERE a.od_request_id = ${requestId} AND a.status = 'pending'
      `);

      const request = await this.prisma.sports_od_requests.findUnique({
        where: { id: requestId },
        select: { event: true, from_date: true, to_date: true },
      });
      if (!request) return;

      for (const row of rows) {
        if (row.hod_user_id == null) continue;
        await this.notifications.notify({
          user_id: row.hod_user_id,
          title: 'Sports OD approval',
          message: `${request.event} (${toDateOnly(request.from_date)} to ${toDateOnly(request.to_date)}) needs your approval for students from your department`,
          type: 'approval_request_pending',
          related_entity_type: 'sports_od_request',
          related_entity_id: requestId,
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to notify HoDs of sports OD request ${requestId}`,
        err,
      );
    }
  }

  /** Tells the requester once the roll-up reaches a final state. */
  private async notifyRequesterOfProgress(requestId: number): Promise<void> {
    try {
      const request = await this.prisma.sports_od_requests.findUnique({
        where: { id: requestId },
        select: { event: true, status: true, requested_by_user_id: true },
      });
      if (!request || request.status === 'pending') return;

      await this.notifications.notify({
        user_id: request.requested_by_user_id,
        title: `Sports OD ${request.status}`,
        message: `${request.event} was ${request.status} by the department head(s)`,
        type:
          request.status === 'approved'
            ? 'approval_request_approved'
            : 'approval_request_rejected',
        related_entity_type: 'sports_od_request',
        related_entity_id: requestId,
      });
    } catch (err) {
      this.logger.error('Failed to notify OD requester', err);
    }
  }
}
