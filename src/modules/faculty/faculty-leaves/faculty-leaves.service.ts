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
import { ROLES } from 'src/common/constants/roles.constant';
import { paginate } from 'src/common/dto/pagination.dto';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { CreateFacultyLeafDto } from './dto/create-faculty-leaf.dto';
import { UpdateFacultyLeafDto } from './dto/update-faculty-leaf.dto';
import { ListFacultyLeafQueryDto } from './dto/list-faculty-leaf-query.dto';

const FACULTY_LEAVE_SELECT = {
  id: true,
  from_date: true,
  to_date: true,
  reason: true,
  leave_type_id: true,
  hod_approval_status: true,
  hr_approval_status: true,
  created_at: true,
  staff_user_id: true,
  faculty: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      designation: true,
      departments: {
        select: { id: true, name: true, code: true },
      },
    },
  },
  // faculty_leaves.faculty_id is NULLABLE: a request raised by non-teaching
  // staff (Secretary, HR Payroll, warden) has staff_user_id set and faculty
  // null. Without this relation such a row carried no name at all, and every
  // client had to guess - the HR review list in the mobile app asserted
  // `row.faculty!` and threw on the first staff-submitted row, which took the
  // whole queue down with "Couldn't load faculty leave requests".
  // Prisma auto-names this relation after the FK column. Plain `users` is a

  // DIFFERENT relation (or absent), so the generated name must be used

  // verbatim - see the note in FacultyLeavesService.resolveDepartmentHodUserId

  // about these names not being stable across `db pull`.

  users_faculty_leaves_staff_user_idTousers: {
    select: {
      email: true,
      non_teaching_staff: {
        select: {
          first_name: true,
          last_name: true,
          departments: { select: { id: true, name: true, code: true } },
        },
      },
    },
  },
  leave_types: { select: { id: true, name: true } },
} as const;

interface FacultyLeaveRow {
  id: number;
  from_date: Date;
  to_date: Date;
  reason: string | null;
  leave_type_id: number | null;
  hod_approval_status: string;
  hr_approval_status: string;
  created_at: Date;
  // Real column, added by the Secretary module completion migration — set
  // for Secretary-authored (non-Faculty) requests, null for Faculty/HoD
  // requests (which keep using faculty_id, unchanged).
  staff_user_id: number | null;
  // Nullable only because faculty_id was relaxed for an unrelated
  // Secretary-facing feature (see the Secretary module completion
  // migration) — every row Faculty/HoD create/read still always has
  // faculty_id set, so this is a compile-time nullability fix, not a real
  // behavior change for them. A Secretary-authored row has faculty: null
  // for real (no faculty row exists for that account).
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
    departments: { id: number; name: string; code: string } | null;
  } | null;
  leave_types: { id: number; name: string } | null;
  // The requester's user row, present so a staff-submitted request (faculty
  // null) still has a name to show. non_teaching_staff.user_id is nullable, so
  // Prisma models the relation as a list.
  users_faculty_leaves_staff_user_idTousers: {
    email: string;
    non_teaching_staff: {
      first_name: string;
      last_name: string | null;
      departments: { id: number; name: string; code: string } | null;
    }[];
  } | null;
}

function computeOverallStatus(
  hod: string,
  hr: string,
): 'pending' | 'approved' | 'rejected' {
  if (hod === 'rejected' || hr === 'rejected') {
    return 'rejected';
  }
  if (hod === 'approved' && hr === 'approved') {
    return 'approved';
  }
  return 'pending';
}

function toResponse(leave: FacultyLeaveRow) {
  return {
    id: leave.id,
    from_date: leave.from_date,
    to_date: leave.to_date,
    reason: leave.reason,
    leave_type: leave.leave_types,
    hod_approval_status: leave.hod_approval_status,
    hr_approval_status: leave.hr_approval_status,
    overall_status: computeOverallStatus(
      leave.hod_approval_status,
      leave.hr_approval_status,
    ),
    created_at: leave.created_at,
    faculty: leave.faculty,
    staff_user_id: leave.staff_user_id,
    // One display identity the client can always render, whichever register
    // the requester lives in. Clients must read this rather than reaching into
    // `faculty`, which is null for staff-submitted rows.
    requester: resolveRequester(leave),
  };
}

/**
 * Display identity for a leave request, from whichever register holds the
 * requester: faculty -> non_teaching_staff -> email. Same order used by
 * resolveRequesterName in media-requests.service.ts and resolveMarkerName in
 * attendance.service.ts.
 */
function resolveRequester(leave: FacultyLeaveRow) {
  if (leave.faculty) {
    return {
      kind: 'faculty' as const,
      name: `${leave.faculty.first_name} ${leave.faculty.last_name}`,
      designation: leave.faculty.designation,
      department: leave.faculty.departments?.code ?? null,
    };
  }
  const staff =
    leave.users_faculty_leaves_staff_user_idTousers?.non_teaching_staff?.[0];
  if (staff) {
    return {
      kind: 'staff' as const,
      name: [staff.first_name, staff.last_name].filter(Boolean).join(' '),
      designation: 'Non-teaching staff',
      department: staff.departments?.code ?? null,
    };
  }
  return {
    kind: 'unknown' as const,
    // Last resort only - an account in neither register.
    name: leave.users_faculty_leaves_staff_user_idTousers?.email ?? 'Unknown',
    designation: null,
    department: null,
  };
}

@Injectable()
export class FacultyLeavesService {
  private readonly logger = new Logger(FacultyLeavesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * POST /faculty-leaves (Faculty or HoD — always for the caller's own
   * faculty record).
   *
   * An HoD's own leave has no one to fill the HoD-review stage (they can't
   * review their own request, and this module has no "escalate to a higher
   * HoD" concept) - so for an HoD-created request, hod_approval_status is
   * set to 'approved' immediately at creation, sending it straight to HR
   * Payroll, per the explicit requirement that an HoD's own leave/OD skips
   * the HoD stage entirely.
   */
  async create(dto: CreateFacultyLeafDto, currentUser: JwtPayload) {
    const fromDate = new Date(dto.from_date);
    const toDate = new Date(dto.to_date);
    const today = new Date(new Date().toISOString().slice(0, 10));

    if (fromDate < today) {
      throw new BadRequestException(
        "from_date must not be before today's date",
      );
    }

    if (fromDate > toDate) {
      throw new BadRequestException('from_date must be on or before to_date');
    }

    // Any non-teaching staff account — no faculty row exists, so there's no
    // HoD to review this at all; goes straight to the HR Payroll stage
    // (hod_approval_status pre-approved), keyed by staff_user_id instead of
    // faculty_id. Mirrors the existing "an HoD's own leave skips the HoD
    // stage" precedent below.
    //
    // Branches on whether the caller ACTUALLY HAS a faculty row, not on their
    // role name. This used to test `role === SECRETARY`, so HR Payroll,
    // warden and every other non-teaching role fell through to the faculty
    // path below and got a FACULTY_NOT_FOUND 404 when applying for their own
    // leave — even though the comment already said "or any non-Faculty staff
    // account". Anything role-shaped here has to be re-edited for every new
    // role; a capability check does not.
    // Full row, not a narrow select: the faculty path below reads
    // department_id/first_name/last_name off it, exactly as
    // resolveFacultyByUserId used to return.
    const facultyRow = await this.prisma.faculty.findUnique({
      where: { user_id: currentUser.sub },
    });

    if (!facultyRow) {
      // Confirm this really is a staff account before writing a staff-keyed
      // row, rather than assuming "not faculty" means "staff".
      // No non_teaching_staff membership check: the row this writes is keyed
      // on staff_user_id, whose FK is to `users` — which the authenticated
      // caller demonstrably has. Demanding a personnel row as well added no
      // integrity and 404d real employees whose non_teaching_staff row was
      // never created.
      const leave = await this.prisma.faculty_leaves.create({
        data: {
          staff_user_id: currentUser.sub,
          from_date: fromDate,
          to_date: toDate,
          reason: dto.reason,
          hod_approval_status: 'approved',
        },
        select: FACULTY_LEAVE_SELECT,
      });
      this.logger.log(`Staff leave request created: id=${leave.id}`);
      return toResponse(leave);
    }

    const faculty = facultyRow;

    const leave = await this.prisma.faculty_leaves.create({
      data: {
        faculty_id: faculty.id,
        from_date: fromDate,
        to_date: toDate,
        reason: dto.reason,
        leave_type_id: dto.leave_type_id,
        hod_approval_status:
          currentUser.role === ROLES.HOD ? 'approved' : undefined,
      },
      select: FACULTY_LEAVE_SELECT,
    });

    this.logger.log(`Faculty leave request created: id=${leave.id}`);

    // An HoD's own leave skips the HoD stage entirely (see this method's
    // own doc comment) and has no single HoD to notify about it - HR
    // Payroll picking up newly-HoD-approved-or-auto-approved requests from
    // their own list is left as a future improvement (notifying an entire
    // role, not one specific person, is a different shape of problem than
    // every other notification here).
    if (currentUser.role !== ROLES.HOD) {
      const hodUserId = await this.resolveDepartmentHodUserId(
        faculty.department_id,
      );
      if (hodUserId) {
        await this.notifications.notify({
          user_id: hodUserId,
          title: 'New leave request to review',
          message: `${faculty.first_name} ${faculty.last_name} requested leave from ${dto.from_date} to ${dto.to_date}.`,
          type: 'approval_request_pending',
          related_entity_type: 'faculty_leave',
          related_entity_id: leave.id,
        });
      }
    }

    return toResponse(leave);
  }

  /**
   * GET /faculty-leaves (Faculty/HoD/HR Payroll). Faculty is always scoped
   * to their own records. HoD is scoped to their own department (previously
   * unscoped - a HoD could see every department's faculty leave requests,
   * not just their own). HR Payroll only ever sees requests the HoD has
   * already approved - a request still awaiting HoD review has nothing for
   * HR to act on yet (update() below 409s "HR approval requires HoD
   * approval first" anyway), so it's hidden from HR's list entirely rather
   * than shown as an unactionable "pending" row. This overrides whatever
   * hod_approval_status the HR caller passes - it is never allowed to see
   * pending/rejected-by-HoD requests.
   */
  async findAll(query: ListFacultyLeafQueryDto, currentUser: JwtPayload) {
    const where: Record<string, unknown> = {
      faculty_id: query.faculty_id,
      hod_approval_status: query.hod_approval_status,
      hr_approval_status: query.hr_approval_status,
    };

    if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty_id = faculty.id;
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      where.faculty = { department_id: hod.department_id };
    } else if (currentUser.role === ROLES.HR_PAYROLL) {
      where.hod_approval_status = 'approved';
    } else if (currentUser.role === ROLES.SECRETARY) {
      // Own requests only, keyed by staff_user_id — no faculty row exists.
      delete where.faculty_id;
      where.staff_user_id = currentUser.sub;
    }

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.faculty_leaves.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: FACULTY_LEAVE_SELECT,
      }),
      this.prisma.faculty_leaves.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /faculty-leaves/:id (Faculty/HoD/HR Payroll). Faculty may only view their own. */
  async findOne(id: number, currentUser: JwtPayload) {
    const leave = await this.prisma.faculty_leaves.findUnique({
      where: { id },
      select: FACULTY_LEAVE_SELECT,
    });

    if (!leave) {
      throw new NotFoundException('Faculty leave request not found');
    }

    if (currentUser.role === ROLES.SECRETARY) {
      if (leave.staff_user_id !== currentUser.sub) {
        throw new ForbiddenException(
          'You may only view your own leave requests',
        );
      }
    } else if (currentUser.role === ROLES.FACULTY) {
      const faculty = await this.resolveFacultyByUserId(currentUser.sub);
      if (leave.faculty?.id !== faculty.id) {
        throw new ForbiddenException(
          'You may only view your own leave requests',
        );
      }
    } else if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      if (leave.faculty?.departments?.id !== hod.department_id) {
        throw new ForbiddenException(
          'You may only view leave requests from your own department',
        );
      }
    }

    return toResponse(leave);
  }

  /**
   * PATCH /faculty-leaves/:id (HoD or HR Payroll only).
   * HoD may only set hod_approval_status. HR Payroll may only set
   * hr_approval_status, and only once hod_approval_status is 'approved'.
   */
  async update(id: number, dto: UpdateFacultyLeafDto, currentUser: JwtPayload) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    const existing = await this.prisma.faculty_leaves.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Faculty leave request not found');
    }

    const data: {
      hod_approval_status?: 'approved' | 'rejected';
      hr_approval_status?: 'approved' | 'rejected';
    } = {};

    if (currentUser.role === ROLES.HOD) {
      const hod = await this.resolveFacultyByUserId(currentUser.sub);
      if (existing.faculty_id === null) {
        throw new InternalServerErrorException({
          message: 'This leave request has no faculty on record',
          errorCode: 'INTERNAL_ERROR',
        });
      }
      if (existing.faculty_id === hod.id) {
        throw new ForbiddenException({
          message: 'You cannot review your own leave request',
          errorCode: 'CANNOT_REVIEW_OWN_REQUEST',
        });
      }
      const requestingFaculty = await this.prisma.faculty.findUnique({
        where: { id: existing.faculty_id },
        select: { department_id: true },
      });
      if (requestingFaculty?.department_id !== hod.department_id) {
        throw new ForbiddenException(
          'You may only approve leave requests from your own department',
        );
      }
      if (dto.hr_approval_status !== undefined) {
        throw new ForbiddenException('HoD may only set hod_approval_status');
      }
      if (dto.hod_approval_status !== undefined) {
        data.hod_approval_status = dto.hod_approval_status;
      }
    } else if (currentUser.role === ROLES.HR_PAYROLL) {
      if (dto.hod_approval_status !== undefined) {
        throw new ForbiddenException(
          'HR Payroll may only set hr_approval_status',
        );
      }
      if (dto.hr_approval_status !== undefined) {
        if (existing.hod_approval_status !== 'approved') {
          throw new ConflictException(
            'HR approval requires HoD approval first',
          );
        }
        data.hr_approval_status = dto.hr_approval_status;
      }
    }

    if (Object.keys(data).length === 0) {
      throw new BadRequestException('No permitted fields provided to update');
    }

    const leave = await this.prisma.faculty_leaves.update({
      where: { id },
      data,
      select: FACULTY_LEAVE_SELECT,
    });

    // Whichever of the two stages was just decided, tell the original
    // requester - never the other stage's approver, since data only ever
    // carries the one field the caller was permitted to set above.
    const decidedStatus = data.hod_approval_status ?? data.hr_approval_status;
    if (decidedStatus !== undefined && existing.faculty_id !== null) {
      const requester = await this.prisma.faculty.findUnique({
        where: { id: existing.faculty_id },
        select: { user_id: true },
      });
      if (requester) {
        const stage =
          data.hod_approval_status !== undefined ? 'HoD' : 'HR Payroll';
        await this.notifications.notify({
          user_id: requester.user_id,
          title:
            decidedStatus === 'approved'
              ? 'Leave request approved'
              : 'Leave request rejected',
          message: `Your leave request (${existing.from_date.toISOString().slice(0, 10)} to ${existing.to_date.toISOString().slice(0, 10)}) was ${decidedStatus} by ${stage}.`,
          type:
            decidedStatus === 'approved'
              ? 'approval_request_approved'
              : 'approval_request_rejected',
          related_entity_type: 'faculty_leave',
          related_entity_id: id,
        });
      }
    }

    return toResponse(leave);
  }

  /** DELETE /faculty-leaves/:id (Faculty/Secretary — own request, and only while fully pending). */
  async remove(id: number, userId: number, role?: string) {
    const existing = await this.prisma.faculty_leaves.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Faculty leave request not found');
    }

    if (role === ROLES.SECRETARY) {
      if (existing.staff_user_id !== userId) {
        throw new ForbiddenException(
          'You may only delete your own leave requests',
        );
      }
    } else {
      const faculty = await this.resolveFacultyByUserId(userId);
      if (existing.faculty_id !== faculty.id) {
        throw new ForbiddenException(
          'You may only delete your own leave requests',
        );
      }
    }

    // A Secretary's own request has hod_approval_status pre-set to
    // 'approved' at creation (no HoD exists to review it — see create()) —
    // that's a real, permanent state for these rows, not "already
    // reviewed", so only hr_approval_status gates withdrawal for them.
    // Faculty/HoD requests keep the original both-stages-pending rule.
    const stillWithdrawable =
      role === ROLES.SECRETARY
        ? existing.hr_approval_status === 'pending'
        : existing.hod_approval_status === 'pending' &&
          existing.hr_approval_status === 'pending';

    if (!stillWithdrawable) {
      throw new ConflictException(
        'Only a still-pending leave request can be withdrawn',
      );
    }

    await this.prisma.faculty_leaves.delete({ where: { id } });

    this.logger.log(`Faculty leave request deleted: id=${id}`);
    return { id, deleted: true };
  }

  /**
   * PATCH-equivalent self-edit: a Secretary may amend the dates/reason of
   * their OWN leave request while it's still awaiting HR Payroll — once HR
   * has decided, edits are frozen (same "no editing a decided request"
   * principle as the HoD/HR update() gate above, just for the requester's
   * own fields instead of the approval fields).
   */
  async updateOwnStaffRequest(
    id: number,
    userId: number,
    dto: { from_date?: string; to_date?: string; reason?: string },
  ) {
    const existing = await this.prisma.faculty_leaves.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException('Faculty leave request not found');
    }
    if (existing.staff_user_id !== userId) {
      throw new ForbiddenException('You may only edit your own leave requests');
    }
    if (existing.hr_approval_status !== 'pending') {
      throw new ConflictException(
        'This request has already been decided and can no longer be edited',
      );
    }

    const data: { from_date?: Date; to_date?: Date; reason?: string } = {};
    if (dto.from_date) data.from_date = new Date(dto.from_date);
    if (dto.to_date) data.to_date = new Date(dto.to_date);
    if (dto.reason !== undefined) data.reason = dto.reason;

    const fromDate = data.from_date ?? existing.from_date;
    const toDate = data.to_date ?? existing.to_date;
    if (fromDate > toDate) {
      throw new BadRequestException('from_date must be on or before to_date');
    }

    const updated = await this.prisma.faculty_leaves.update({
      where: { id },
      data,
      select: FACULTY_LEAVE_SELECT,
    });
    return toResponse(updated);
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
   * Two plain sequential queries rather than one nested relation select -
   * Prisma's auto-generated relation field names on `departments` (e.g.
   * `faculty_departments_head_of_department_faculty_idTofaculty`) are not
   * stable across `db pull` runs, so this avoids depending on that name.
   */
  private async resolveDepartmentHodUserId(
    departmentId: number,
  ): Promise<number | null> {
    const department = await this.prisma.departments.findUnique({
      where: { id: departmentId },
      select: { head_of_department_faculty_id: true },
    });
    if (!department?.head_of_department_faculty_id) {
      return null;
    }
    const hod = await this.prisma.faculty.findUnique({
      where: { id: department.head_of_department_faculty_id },
      select: { user_id: true },
    });
    return hod?.user_id ?? null;
  }
}
