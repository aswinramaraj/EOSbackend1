import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListHrRequestsQueryDto } from './dto/list-hr-requests-query.dto';
import { CreateHrVacationEntryDto } from './dto/create-hr-vacation-entry.dto';

// Capped per-source fetch — there is no shared generic request table to
// paginate across natively, so both sources are pulled, merged in memory,
// then paginated. Fine at this scale; revisit if either table grows large
// enough for this cap to matter.
const PER_SOURCE_FETCH_LIMIT = 300;

function overallStatus(
  hod: string,
  hr: string,
): 'pending' | 'approved' | 'rejected' {
  if (hod === 'rejected' || hr === 'rejected') return 'rejected';
  if (hod === 'approved' && hr === 'approved') return 'approved';
  return 'pending';
}

function academicYearFor(date: Date): string {
  const calendarYear = date.getUTCFullYear();
  const academicStartYear =
    date.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}

interface LeaveTypeRef {
  id: number;
  name: string;
}

export interface UnifiedRequest {
  id: string;
  kind: 'leave' | 'od';
  source_id: number;
  faculty: {
    id: number;
    prefix: string | null;
    first_name: string;
    last_name: string;
    designation: string;
    profile_url: string | null;
    department: { id: number; name: string };
  };
  from_date: Date;
  to_date: Date;
  detail: string | null;
  // Only ever set for kind 'leave' — OD has no sub-type concept.
  leave_type: LeaveTypeRef | null;
  hod_approval_status: string;
  hr_approval_status: string;
  overall_status: 'pending' | 'approved' | 'rejected';
  created_at: Date;
}

/**
 * Normalises the requester across both shapes.
 *
 * `faculty_leaves.faculty_id` and `faculty_od_requests.faculty_id` are
 * nullable: a non-teaching staff account (the Secretary portal, for one) raises
 * leave and OD against `staff_user_id` with no faculty row behind it.
 * Dereferencing the relation unconditionally threw a TypeError, and because a
 * single such row exists the whole Requests tab returned 500 — while filtering
 * by department appeared to work, only because that filter implicitly excludes
 * rows with no faculty.
 */
function resolveRequester(
  faculty: {
    id: number;
    prefix: string | null;
    first_name: string;
    last_name: string;
    designation: string;
    profile_url: string | null;
    departments: { id: number; name: string } | null;
  } | null,
  staffUserId: number | null,
): UnifiedRequest['faculty'] {
  if (faculty) {
    return {
      id: faculty.id,
      prefix: faculty.prefix,
      first_name: faculty.first_name,
      last_name: faculty.last_name,
      designation: faculty.designation,
      profile_url: faculty.profile_url,
      // Nullable in the schema even though a faculty row has one in practice,
      // so it is not asserted.
      department: faculty.departments ?? { id: 0, name: 'Unassigned' },
    };
  }
  // No faculty record exists to name them from, so the row says what it is
  // rather than rendering blank.
  return {
    id: 0,
    prefix: null,
    first_name: 'Non-teaching staff',
    last_name: staffUserId != null ? `(user ${staffUserId})` : '',
    designation: 'Staff',
    profile_url: null,
    department: { id: 0, name: 'Non-teaching / unassigned' },
  };
}


interface FacultyRef {
  id: number;
  prefix: string | null;
  first_name: string;
  last_name: string;
  designation: string;
  profile_url: string | null;
  departments: { id: number; name: string };
}

interface LeaveRow {
  id: number;
  from_date: Date;
  to_date: Date;
  reason: string | null;
  leave_types: LeaveTypeRef | null;
  hod_approval_status: string;
  hr_approval_status: string;
  created_at: Date;
  faculty: FacultyRef;
}

interface OdRow {
  id: number;
  from_date: Date;
  to_date: Date;
  purpose: string | null;
  hod_approval_status: string;
  hr_approval_status: string;
  created_at: Date;
  faculty: FacultyRef;
}

/**
 * HR's unified request inbox — a read-only merge of faculty_leaves and
 * faculty_od_requests. Deliberately NOT a new "HRRequest" table: both source
 * tables already exist and are each other's source of truth for their own
 * domain, this just presents them together for HR's dashboard/inbox view.
 */
@Injectable()
export class HrRequestsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListHrRequestsQueryDto) {
    const facultyWhere: Record<string, unknown> = {};
    if (query.department_id) facultyWhere.department_id = query.department_id;

    const leaveWhere: Record<string, unknown> = {
      faculty_id: query.faculty_id,
      ...(Object.keys(facultyWhere).length ? { faculty: facultyWhere } : {}),
    };
    const odWhere: Record<string, unknown> = {
      faculty_id: query.faculty_id,
      ...(Object.keys(facultyWhere).length ? { faculty: facultyWhere } : {}),
    };

    const [leaves, odRequests] = await Promise.all([
      query.kind === 'od'
        ? Promise.resolve<LeaveRow[]>([])
        : this.prisma.faculty_leaves.findMany({
            where: leaveWhere,
            take: PER_SOURCE_FETCH_LIMIT,
            orderBy: { created_at: 'desc' },
            select: {
              id: true,
              from_date: true,
              to_date: true,
              reason: true,
              hod_approval_status: true,
              hr_approval_status: true,
              created_at: true,
              // Staff requests carry no faculty row; this identifies them instead.
              staff_user_id: true,
              leave_types: { select: { id: true, name: true } },
              faculty: {
                select: {
                  id: true,
                  prefix: true,
                  first_name: true,
                  last_name: true,
                  designation: true,
                  profile_url: true,
                  departments: { select: { id: true, name: true } },
                },
              },
            },
          }),
      query.kind === 'leave'
        ? Promise.resolve<OdRow[]>([])
        : this.prisma.faculty_od_requests.findMany({
            where: odWhere,
            take: PER_SOURCE_FETCH_LIMIT,
            orderBy: { created_at: 'desc' },
            select: {
              id: true,
              from_date: true,
              to_date: true,
              // Staff requests carry no faculty row; this identifies them instead.
              staff_user_id: true,
              purpose: true,
              hod_approval_status: true,
              hr_approval_status: true,
              created_at: true,
              faculty: {
                select: {
                  id: true,
                  prefix: true,
                  first_name: true,
                  last_name: true,
                  designation: true,
                  profile_url: true,
                  departments: { select: { id: true, name: true } },
                },
              },
            },
          }),
    ]);

    let unified: UnifiedRequest[] = [
      ...leaves.map((leave): UnifiedRequest => ({
        id: `leave-${leave.id}`,
        kind: 'leave',
        source_id: leave.id,
        faculty: resolveRequester(leave.faculty, leave.staff_user_id),
        from_date: leave.from_date,
        to_date: leave.to_date,
        detail: leave.reason,
        leave_type: leave.leave_types,
        hod_approval_status: leave.hod_approval_status,
        hr_approval_status: leave.hr_approval_status,
        overall_status: overallStatus(
          leave.hod_approval_status,
          leave.hr_approval_status,
        ),
        created_at: leave.created_at,
      })),
      ...odRequests.map((od): UnifiedRequest => ({
        id: `od-${od.id}`,
        kind: 'od',
        source_id: od.id,
        faculty: resolveRequester(od.faculty, od.staff_user_id),
        from_date: od.from_date,
        to_date: od.to_date,
        detail: od.purpose,
        leave_type: null,
        hod_approval_status: od.hod_approval_status,
        hr_approval_status: od.hr_approval_status,
        overall_status: overallStatus(
          od.hod_approval_status,
          od.hr_approval_status,
        ),
        created_at: od.created_at,
      })),
    ];

    if (query.status) {
      unified = unified.filter((r) => r.overall_status === query.status);
    }

    unified.sort((a, b) => b.created_at.getTime() - a.created_at.getTime());

    const total = unified.length;
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const start = (page - 1) * limit;
    const data = unified.slice(start, start + limit);

    return {
      data,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * HR recording a leave/OD entry directly on a faculty member's behalf —
   * e.g. from the Vacation Management calendar. Accepts a real from/to
   * range (a single day is just from_date === to_date). Skips the normal
   * self-service + approval flow entirely (both approval columns are set
   * straight to 'approved') since HR is the one entering it, not routing a
   * new request for review. Logged to faculty_activity_log since neither
   * table has a column of its own to record who added the row.
   */
  async createEntry(
    dto: CreateHrVacationEntryDto,
    actorUserId: number,
  ): Promise<UnifiedRequest> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: dto.faculty_id },
      select: {
        id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        designation: true,
        profile_url: true,
        departments: { select: { id: true, name: true } },
      },
    });
    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }

    const fromDate = new Date(`${dto.from_date}T00:00:00.000Z`);
    const toDate = new Date(`${dto.to_date}T00:00:00.000Z`);
    if (fromDate > toDate) {
      throw new BadRequestException('from_date must not be after to_date');
    }
    const facultyRef = {
      id: faculty.id,
      prefix: faculty.prefix,
      first_name: faculty.first_name,
      last_name: faculty.last_name,
      designation: faculty.designation,
      profile_url: faculty.profile_url,
      department: faculty.departments,
    };
    const rangeLabel =
      dto.from_date === dto.to_date
        ? dto.from_date
        : `${dto.from_date} to ${dto.to_date}`;

    // Leave/OD (this table) and attendance (faculty_daily_attendance) are
    // otherwise two entirely separate systems — without this, adding
    // someone to a range here left the Attendance page showing whatever it
    // already had (or nothing at all) for those dates, with no indication a
    // Leave/OD was ever recorded. One row per calendar day (mirrors
    // removeEntry's own cursor loop) — only fills in a day that has no
    // explicit attendance row yet, never overwrites one, since an existing
    // row means HR or a punch already recorded what actually happened that
    // day, which this shouldn't second-guess.
    const attendanceStatus = dto.kind === 'leave' ? 'on_leave' : 'on_duty';
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      const existingAttendance =
        await this.prisma.faculty_daily_attendance.findUnique({
          where: {
            faculty_id_attendance_date: {
              faculty_id: dto.faculty_id,
              attendance_date: cursor,
            },
          },
        });
      if (!existingAttendance) {
        await this.prisma.faculty_daily_attendance.create({
          data: {
            faculty_id: dto.faculty_id,
            attendance_date: new Date(cursor),
            status: attendanceStatus,
            academic_year: academicYearFor(cursor),
          },
        });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    if (dto.kind === 'leave') {
      const row = await this.prisma.faculty_leaves.create({
        data: {
          faculty_id: dto.faculty_id,
          from_date: fromDate,
          to_date: toDate,
          reason: dto.reason,
          leave_type_id: dto.leave_type_id,
          hod_approval_status: 'approved',
          hr_approval_status: 'approved',
        },
        select: {
          id: true,
          from_date: true,
          to_date: true,
          reason: true,
          hod_approval_status: true,
          hr_approval_status: true,
          created_at: true,
          leave_types: { select: { id: true, name: true } },
        },
      });
      await this.prisma.faculty_activity_log.create({
        data: {
          faculty_id: dto.faculty_id,
          description: `Leave for ${rangeLabel} added directly by HR.`,
          created_by_user_id: actorUserId,
        },
      });
      return {
        id: `leave-${row.id}`,
        kind: 'leave',
        source_id: row.id,
        faculty: facultyRef,
        from_date: row.from_date,
        to_date: row.to_date,
        detail: row.reason,
        leave_type: row.leave_types,
        hod_approval_status: row.hod_approval_status,
        hr_approval_status: row.hr_approval_status,
        overall_status: 'approved',
        created_at: row.created_at,
      };
    }

    const row = await this.prisma.faculty_od_requests.create({
      data: {
        faculty_id: dto.faculty_id,
        from_date: fromDate,
        to_date: toDate,
        purpose: dto.reason,
        hod_approval_status: 'approved',
        hr_approval_status: 'approved',
      },
    });
    await this.prisma.faculty_activity_log.create({
      data: {
        faculty_id: dto.faculty_id,
        description: `OD for ${rangeLabel} added directly by HR.`,
        created_by_user_id: actorUserId,
      },
    });
    return {
      id: `od-${row.id}`,
      kind: 'od',
      source_id: row.id,
      faculty: facultyRef,
      from_date: row.from_date,
      to_date: row.to_date,
      detail: row.purpose,
      leave_type: null,
      hod_approval_status: row.hod_approval_status,
      hr_approval_status: row.hr_approval_status,
      overall_status: 'approved',
      created_at: row.created_at,
    };
  }

  async removeEntry(kind: 'leave' | 'od', id: number) {
    let facultyId: number | null;
    let fromDate: Date;
    let toDate: Date;

    if (kind === 'leave') {
      const existing = await this.prisma.faculty_leaves.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new NotFoundException('Leave request not found');
      }
      facultyId = existing.faculty_id;
      fromDate = existing.from_date;
      toDate = existing.to_date;
      await this.prisma.faculty_leaves.delete({ where: { id } });
    } else {
      const existing = await this.prisma.faculty_od_requests.findUnique({
        where: { id },
      });
      if (!existing) {
        throw new NotFoundException('OD request not found');
      }
      facultyId = existing.faculty_id;
      fromDate = existing.from_date;
      toDate = existing.to_date;
      await this.prisma.faculty_od_requests.delete({ where: { id } });
    }

    // A Secretary-authored (staff_user_id) row has no faculty_id at all —
    // this HR module only ever creates faculty-linked entries itself, so a
    // null here means the id belongs to a row this module didn't create;
    // nothing to sync back in faculty_daily_attendance for it.
    if (facultyId === null) {
      return { id, kind, deleted: true };
    }

    // Undoes exactly what createEntry's sync does, and only that — a row is
    // only cleared if its status still matches what this cancelled entry
    // would have synced (on_leave/on_duty) and it has no punch times, so a
    // real punch-based full_day/half_day record (or one for a status this
    // entry never set) is never touched.
    const expectedStatus = kind === 'leave' ? 'on_leave' : 'on_duty';
    const cursor = new Date(fromDate);
    while (cursor <= toDate) {
      await this.prisma.faculty_daily_attendance.deleteMany({
        where: {
          faculty_id: facultyId,
          attendance_date: cursor,
          status: expectedStatus,
          punch_in: null,
          punch_out: null,
        },
      });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    return { id, kind, deleted: true };
  }
}
