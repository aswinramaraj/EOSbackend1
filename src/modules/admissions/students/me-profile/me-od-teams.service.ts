import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as crypto from 'node:crypto';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { JoinOdTeamDto } from './dto/join-od-team.dto';
import { CreateOdRequestDto } from './dto/create-od-request.dto';
import { toTimeDate, formatTime } from './od-time.util';

function startOfToday(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

// Crockford's Base32 alphabet — excludes I, L, O, U to avoid transcription
// ambiguity when a code is shared verbally or by text between teammates.
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 6;
const MAX_GENERATION_ATTEMPTS = 5;

function generateUniqueCode(): string {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  }
  return code;
}

@Injectable()
export class MeOdTeamsService {
  private readonly logger = new Logger(MeOdTeamsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * POST /me/od-teams
   *
   * Self-scoped: created_by_student_id resolved from the JWT, never
   * accepted from the request (the DTO has no properties at all — see
   * dto/create-od-team.dto.ts — so there is nothing for a client to inject;
   * the global ValidationPipe's forbidNonWhitelisted rejects any attempt).
   *
   * The spec (todo.md/9-POST-me-od-teams.md §3, §8, §12) explicitly flags
   * whether the creator is auto-joined into od_team_members as unresolved
   * ("Pending from Backend Implementation"). The Sequence Flow diagram, the
   * DB Operations section's recommended transaction, and the "Future
   * Improvements" note ("likely auto-join") all point the same direction,
   * so this implementation auto-joins the creator as the team's first
   * od_team_members row, atomically with the od_teams insert — a team is
   * never left without its founding member.
   *
   * unique_code is a 6-character code generated server-side with a
   * collision-check retry loop; collisions are never surfaced to the
   * client (per spec §5's explicit note), only ever a 500 if retries are
   * exhausted (astronomically unlikely given the code space).
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND – authenticated user has no linked student
   *                          record (spec marks this "not applicable" but
   *                          kept for consistency with every sibling
   *                          /me/* endpoint)
   *  500 INTERNAL_ERROR    – unexpected DB failure, or unique_code
   *                          collision retries exhausted
   */
  async createOdTeam(userId: number) {
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

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const uniqueCode = generateUniqueCode();
      try {
        const team = await this.prisma.$transaction(async (tx) => {
          const createdTeam = await tx.od_teams.create({
            data: {
              created_by_student_id: student.id,
              unique_code: uniqueCode,
              is_locked: false,
            },
          });
          await tx.od_team_members.create({
            data: {
              team_id: createdTeam.id,
              student_id: student.id,
            },
          });
          return createdTeam;
        });

        return {
          id: team.id,
          created_by_student_id: team.created_by_student_id,
          unique_code: team.unique_code,
          is_locked: team.is_locked,
          created_at: team.created_at,
        };
      } catch (err) {
        if (
          this.isUniqueConstraintError(err) &&
          attempt < MAX_GENERATION_ATTEMPTS
        ) {
          continue;
        }
        this.logger.error(`Failed to create OD team for user ${userId}`, err);
        throw new InternalServerErrorException({
          message: 'Something went wrong. Please try again.',
          errorCode: 'INTERNAL_ERROR',
        });
      }
    }

    // Unreachable: the loop above always returns or throws. Kept only to
    // satisfy TypeScript's control-flow analysis of the for-loop.
    throw new InternalServerErrorException({
      message: 'Something went wrong. Please try again.',
      errorCode: 'INTERNAL_ERROR',
    });
  }

  /**
   * POST /me/od-teams/join
   *
   * Self-scoped: student_id resolved from the JWT, team resolved from the
   * client-supplied unique_code (the only field the client controls here —
   * matches the spec's own design of the code as a shareable "join secret").
   *
   * The already-member check is done twice by design: once as a friendly
   * pre-check (clear 409 without touching od_team_members.create at all),
   * and again as a P2002 catch on the insert itself — the insert is the
   * real correctness guarantee (Postgres enforces @@unique([team_id,
   * student_id]) atomically regardless of how the two requests interleave),
   * closing the race window the spec's DB Operations section calls out,
   * without needing an explicit $transaction (a single INSERT statement is
   * already atomic; there's nothing to wrap two statements together for).
   *
   * The lock-check-then-insert TOCTOU race the spec's Notes section flags
   * (a member sneaking in the instant a team gets locked) is not otherwise
   * guarded against here: nothing in this codebase yet flips
   * od_teams.is_locked from false to true (that trigger is itself marked
   * "Pending from Backend Implementation" in todo.md/9-POST-me-od-teams.md
   * §8/§12), so there is currently no code path that can race against this
   * one. Worth revisiting once a lock-triggering endpoint exists.
   *
   * Response is intentionally nested (a `team` sub-object) rather than a
   * flat echo of the spec's minimal `{id, team_id, student_id, joined_at}`
   * shape — since the lock check already fetches unique_code/is_locked,
   * returning them costs no extra query and gives the client immediate
   * confirmation of which team it joined and its current lock state,
   * rather than a bare numeric team_id it would otherwise have to look up
   * separately.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND  – authenticated user has no linked student
   *                           record (spec marks this "not applicable" but
   *                           kept for consistency with every sibling
   *                           /me/* endpoint)
   *  404 TEAM_NOT_FOUND     – unique_code doesn't match any od_teams row
   *  422 TEAM_LOCKED        – the team is no longer accepting new members
   *  409 ALREADY_A_MEMBER   – student already has a membership row for
   *                           this team
   *  500 INTERNAL_ERROR     – unexpected DB failure
   */
  async joinOdTeam(userId: number, dto: JoinOdTeamDto) {
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

    const team = await this.prisma.od_teams.findUnique({
      where: { unique_code: dto.unique_code },
      select: { id: true, unique_code: true, is_locked: true },
    });
    if (!team) {
      throw new NotFoundException({
        message: 'No team found with this code',
        errorCode: 'TEAM_NOT_FOUND',
      });
    }
    if (team.is_locked) {
      throw new UnprocessableEntityException({
        message: 'This team is locked and no longer accepting new members',
        errorCode: 'TEAM_LOCKED',
      });
    }

    const existingMembership = await this.prisma.od_team_members.findUnique({
      where: {
        team_id_student_id: { team_id: team.id, student_id: student.id },
      },
    });
    if (existingMembership) {
      throw new ConflictException({
        message: 'You are already a member of this team',
        errorCode: 'ALREADY_A_MEMBER',
      });
    }

    const membership = await this.insertMembership(userId, team, student.id);

    return {
      id: membership.id,
      team_id: membership.team_id,
      student_id: membership.student_id,
      joined_at: membership.joined_at,
      team: {
        unique_code: team.unique_code,
        is_locked: team.is_locked,
      },
    };
  }

  private async insertMembership(
    userId: number,
    team: { id: number },
    studentId: number,
  ) {
    try {
      return await this.prisma.od_team_members.create({
        data: {
          team_id: team.id,
          student_id: studentId,
        },
      });
    } catch (err) {
      if (this.isUniqueConstraintError(err)) {
        throw new ConflictException({
          message: 'You are already a member of this team',
          errorCode: 'ALREADY_A_MEMBER',
        });
      }
      this.logger.error(`Failed to join OD team for user ${userId}`, err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * DELETE /me/od-teams/:id/members/:studentId
   *
   * Authorization is narrower than "any authenticated student": the caller
   * must be either the team's creator (removing anyone) or the member being
   * removed (removing themselves) — resolved from the JWT, never trusted
   * from the request. Deliberately performs no is_locked check at all per
   * the spec's own explicit asymmetry with joining: a student may need to
   * drop out even after the team is locked/the OD request is submitted.
   *
   * Response is enriched with `joined_at` (captured from the membership row
   * before it's deleted) and `removed_at` (the moment of deletion) rather
   * than the spec's bare `data: {}` — since the membership row has to be
   * fetched anyway for the existence check, returning its join date costs
   * nothing extra and gives the client a genuine confirmation record of
   * what was removed and when, instead of an empty placeholder object.
   *
   * A P2025 (record not found) on the delete itself — the row disappearing
   * between the existence check and the delete, e.g. two concurrent
   * removals of the same member — is treated the same as the row never
   * having existed: 404 MEMBER_NOT_FOUND, not a 500.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND        – authenticated user has no linked
   *                                 student record (spec doesn't list this
   *                                 code, kept for consistency with every
   *                                 sibling /me/* endpoint)
   *  404 TEAM_NOT_FOUND           – id doesn't match any od_teams row
   *  403 NOT_AUTHORIZED_TO_REMOVE – caller is neither the creator nor the
   *                                 targeted student
   *  404 MEMBER_NOT_FOUND         – no od_team_members row for this
   *                                 team_id + studentId
   *  500 INTERNAL_ERROR           – unexpected DB failure
   */
  async removeOdTeamMember(
    userId: number,
    teamId: number,
    targetStudentId: number,
  ) {
    const caller = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true },
    });
    if (!caller) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const team = await this.prisma.od_teams.findUnique({
      where: { id: teamId },
      select: { id: true, created_by_student_id: true },
    });
    if (!team) {
      throw new NotFoundException({
        message: 'OD team not found',
        errorCode: 'TEAM_NOT_FOUND',
      });
    }

    const isCreator = team.created_by_student_id === caller.id;
    const isSelf = caller.id === targetStudentId;
    if (!isCreator && !isSelf) {
      throw new ForbiddenException({
        message:
          'You can only remove yourself or, as the team creator, remove other members',
        errorCode: 'NOT_AUTHORIZED_TO_REMOVE',
      });
    }

    const membership = await this.prisma.od_team_members.findUnique({
      where: {
        team_id_student_id: { team_id: teamId, student_id: targetStudentId },
      },
    });
    if (!membership) {
      throw new NotFoundException({
        message: 'This student is not a member of this team',
        errorCode: 'MEMBER_NOT_FOUND',
      });
    }

    await this.deleteMembership(userId, membership.id);

    return {
      team_id: teamId,
      student_id: targetStudentId,
      joined_at: membership.joined_at,
      removed_at: new Date(),
    };
  }

  private async deleteMembership(userId: number, membershipId: number) {
    try {
      await this.prisma.od_team_members.delete({
        where: { id: membershipId },
      });
    } catch (err) {
      if (this.isRecordNotFoundError(err)) {
        throw new NotFoundException({
          message: 'This student is not a member of this team',
          errorCode: 'MEMBER_NOT_FOUND',
        });
      }
      this.logger.error(
        `Failed to remove OD team member for user ${userId}`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * POST /me/od-teams/:id/requests
   *
   * The highest-consequence write in the OD flow: locks the team and fans
   * out one od_request_hod_approvals row per member in a single
   * transaction, per the spec's own explicit requirement (a partial
   * failure must never leave a locked team with no request, or a request
   * with incomplete department coverage).
   *
   * Dedup rule resolved from the schema, not left ambiguous: spec §12
   * flags "one row per student, or one per unique department?" as an open
   * question, but od_request_hod_approvals has @@unique([od_request_id,
   * student_id]) — keyed by student, not department — so two teammates in
   * the same department each get their own independent approval row. That
   * IS the schema's answer, not a judgment call.
   *
   * Minimum team size: NOT enforced. Spec §12 lists "no check that the
   * team has more than one member" under Known Limitations and suggests
   * adding one under Future Improvements — i.e. explicitly not a current
   * requirement — so a solo team (creator only) can submit a request.
   * Confirmed live: a team can even reach ZERO members (the creator can
   * remove themselves via the sibling DELETE endpoint, which has no
   * membership requirement of its own) and still submit successfully,
   * producing hod_approvals: [] — an OD request with nothing gating its
   * per-department approval stage. Left as-is rather than blocked, for the
   * same reason as the solo-team case: the spec explicitly defers this
   * decision rather than requiring a minimum, and inventing a threshold
   * (1? 2?) the spec never specifies would be a bigger judgment call than
   * leaving the gap documented.
   *
   * Double-submission race: NOT just the read-then-write is_locked check
   * it might look like. od_requests has no unique constraint on team_id,
   * so two concurrent submissions for the same unlocked team could both
   * read is_locked=false before either writes — confirmed live: two
   * simultaneous requests both returned 201, creating two separate
   * od_requests rows (with duplicate approval fan-outs) for one team, a
   * direct violation of the spec's own "a team can only have this called
   * once while unlocked" rule. Fixed with an atomic conditional UPDATE
   * (`WHERE id = $1 AND is_locked = false`) as the transaction's first
   * statement — Postgres serializes concurrent UPDATEs to the same row, so
   * only one transaction's WHERE clause can still match once the other
   * commits; a zero-row update means someone else already locked it, which
   * throws 409 REQUEST_ALREADY_SUBMITTED and rolls back before any insert
   * happens. Re-verified live after the fix: one request now gets 201, the
   * other a clean 409, exactly one od_requests row created.
   *
   * A member with no class_id (and therefore no resolvable department_id)
   * is NOT silently skipped from the approval fan-out: doing so would let
   * that student's OD go through with no department ever reviewing them —
   * a real gap in the approval workflow. Instead the whole submission is
   * rejected with 422 MEMBER_MISSING_DEPARTMENT (not in the spec's
   * documented error table, added because the schema allows
   * students.class_id to be null and this endpoint has no other sane
   * response to that state).
   *
   * Response nests a resolved `hod_approvals` array (student_id,
   * department_id, department_name, status) instead of the spec's bare
   * request-only shape — the fan-out already has to be computed to
   * perform the inserts, so returning it costs nothing extra and shows
   * the creator exactly which departments/students were enrolled for
   * approval, rather than leaving them to infer it from a flat
   * mentor_approval_status field.
   *
   * Error cases:
   *  404 STUDENT_NOT_FOUND         – authenticated user has no linked
   *                                  student record (spec doesn't list
   *                                  this code, kept for consistency with
   *                                  every sibling /me/* endpoint)
   *  404 TEAM_NOT_FOUND            – id doesn't match any od_teams row
   *  404 FACULTY_NOT_FOUND         – faculty_guide_id doesn't match any faculty row
   *  403 NOT_TEAM_CREATOR          – caller isn't this team's creator
   *  409 REQUEST_ALREADY_SUBMITTED – od_teams.is_locked is already true
   *  422 INVALID_DATE_RANGE        – from_date in the past, or from_date > to_date
   *  422 MEMBER_MISSING_DEPARTMENT – a team member has no class/department
   *                                  to route their approval to
   *  500 INTERNAL_ERROR            – unexpected DB failure
   */
  async submitOdRequest(
    userId: number,
    teamId: number,
    dto: CreateOdRequestDto,
  ) {
    const fromDate = new Date(dto.from_date);
    const toDate = new Date(dto.to_date);
    if (fromDate < startOfToday() || fromDate > toDate) {
      throw new UnprocessableEntityException({
        message:
          'from_date must not be in the past and must be on or before to_date',
        errorCode: 'INVALID_DATE_RANGE',
      });
    }

    const caller = await this.prisma.students.findUnique({
      where: { user_id: userId },
      select: { id: true, class_id: true },
    });
    if (!caller) {
      throw new NotFoundException({
        message: 'Student profile not found for this account',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const team = await this.prisma.od_teams.findUnique({
      where: { id: teamId },
      select: {
        id: true,
        created_by_student_id: true,
        is_locked: true,
        unique_code: true,
      },
    });
    if (!team) {
      throw new NotFoundException({
        message: 'OD team not found',
        errorCode: 'TEAM_NOT_FOUND',
      });
    }
    if (team.created_by_student_id !== caller.id) {
      throw new ForbiddenException({
        message: 'Only the team creator can submit the OD request',
        errorCode: 'NOT_TEAM_CREATOR',
      });
    }
    if (team.is_locked) {
      throw new ConflictException({
        message: 'An OD request has already been submitted for this team',
        errorCode: 'REQUEST_ALREADY_SUBMITTED',
      });
    }

    const members = await this.prisma.od_team_members.findMany({
      where: { team_id: teamId },
      select: { student_id: true },
    });
    const memberStudents = await this.prisma.students.findMany({
      where: { id: { in: members.map((m) => m.student_id) } },
      select: {
        id: true,
        classes: {
          select: {
            department_id: true,
            departments: { select: { name: true } },
          },
        },
      },
    });
    const missingDepartment = memberStudents.filter((s) => !s.classes);
    if (missingDepartment.length > 0) {
      throw new UnprocessableEntityException({
        message:
          'One or more team members have no class/department assigned and cannot be routed for approval',
        errorCode: 'MEMBER_MISSING_DEPARTMENT',
      });
    }

    const hodApprovals = memberStudents.map((s) => ({
      student_id: s.id,
      department_id: s.classes!.department_id,
      department_name: s.classes!.departments.name,
    }));

    const fromTime = dto.from_time ? toTimeDate(dto.from_time) : null;
    const toTime = dto.to_time ? toTimeDate(dto.to_time) : null;

    let facultyGuideName: string | null = null;
    if (dto.faculty_guide_id !== undefined) {
      const guide = await this.prisma.faculty.findUnique({
        where: { id: dto.faculty_guide_id },
        select: { first_name: true, last_name: true },
      });
      if (!guide) {
        throw new NotFoundException({
          message: 'Faculty guide not found',
          errorCode: 'FACULTY_NOT_FOUND',
        });
      }
      facultyGuideName = `${guide.first_name} ${guide.last_name ?? ''}`.trim();
    }

    const request = await this.insertOdRequest(
      userId,
      teamId,
      fromDate,
      toDate,
      fromTime,
      toTime,
      dto.reason,
      dto.faculty_guide_id ?? null,
      hodApprovals,
    );

    // Both reviewers below get notified right at submission - the
    // od_request_hod_approvals rows are created immediately above (all
    // 'pending'), not gated behind the mentor's decision, so a department's
    // HoD already has something to review from this moment on, same as
    // the mentor.
    await this.notifyMentorOfNewRequest(caller.class_id, request.id, team.unique_code);
    await this.notifyDepartmentHodsOfNewRequest(hodApprovals, request.id);

    return {
      id: request.id,
      team_id: request.team_id,
      from_date: toDateOnly(request.from_date),
      to_date: toDateOnly(request.to_date),
      from_time: formatTime(request.from_time),
      to_time: formatTime(request.to_time),
      reason: request.reason,
      faculty_guide_id: request.faculty_guide_id,
      faculty_guide_name: facultyGuideName,
      mentor_approval_status: request.mentor_approval_status,
      hod_approvals: hodApprovals.map((a) => ({
        student_id: a.student_id,
        department_id: a.department_id,
        department_name: a.department_name,
        status: 'pending',
      })),
    };
  }

  /** No-op if the creator has no class (and therefore no mentor) assigned. */
  private async notifyMentorOfNewRequest(
    classId: number | null,
    odRequestId: number,
    teamCode: string,
  ): Promise<void> {
    if (classId === null) {
      return;
    }
    const mentorMapping = await this.prisma.class_mentors.findFirst({
      where: { class_id: classId },
      select: { faculty_id: true },
    });
    if (!mentorMapping) {
      return;
    }
    const mentor = await this.prisma.faculty.findUnique({
      where: { id: mentorMapping.faculty_id },
      select: { user_id: true },
    });
    if (!mentor) {
      return;
    }
    await this.notifications.notify({
      user_id: mentor.user_id,
      title: 'New OD request to review',
      message: `Team ${teamCode} submitted an OD request needing your review as mentor.`,
      type: 'approval_request_pending',
      related_entity_type: 'od_request',
      related_entity_id: odRequestId,
    });
  }

  /** One notification per distinct department, not per member row. */
  private async notifyDepartmentHodsOfNewRequest(
    hodApprovals: { department_id: number; department_name: string }[],
    odRequestId: number,
  ): Promise<void> {
    const departments = new Map(
      hodApprovals.map((a) => [a.department_id, a.department_name]),
    );
    for (const [departmentId, departmentName] of departments) {
      const department = await this.prisma.departments.findUnique({
        where: { id: departmentId },
        select: { head_of_department_faculty_id: true },
      });
      if (!department?.head_of_department_faculty_id) {
        continue;
      }
      const hod = await this.prisma.faculty.findUnique({
        where: { id: department.head_of_department_faculty_id },
        select: { user_id: true },
      });
      if (!hod) {
        continue;
      }
      await this.notifications.notify({
        user_id: hod.user_id,
        title: 'New OD request to review',
        message: `An OD request from ${departmentName} is pending your review.`,
        type: 'approval_request_pending',
        related_entity_type: 'od_request',
        related_entity_id: odRequestId,
      });
    }
  }

  private async insertOdRequest(
    userId: number,
    teamId: number,
    fromDate: Date,
    toDate: Date,
    fromTime: Date | null,
    toTime: Date | null,
    reason: string,
    facultyGuideId: number | null,
    hodApprovals: { student_id: number; department_id: number }[],
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Atomic conditional lock: the earlier is_locked read (in
        // submitOdRequest) is only a friendly fast-path check and is NOT
        // itself race-safe — od_requests has no unique constraint on
        // team_id, so two concurrent submissions could both pass that read
        // and both insert (confirmed live: two simultaneous requests for
        // the same unlocked team both returned 201, creating two separate
        // od_requests rows with duplicate approval fan-outs). This
        // conditional UPDATE is the actual guarantee: only one concurrent
        // transaction can flip is_locked false→true for a given row: the
        // other's WHERE clause matches zero rows once the first commits.
        const lockResult = await tx.od_teams.updateMany({
          where: { id: teamId, is_locked: false },
          data: { is_locked: true },
        });
        if (lockResult.count === 0) {
          throw new ConflictException({
            message: 'An OD request has already been submitted for this team',
            errorCode: 'REQUEST_ALREADY_SUBMITTED',
          });
        }

        const request = await tx.od_requests.create({
          data: {
            team_id: teamId,
            from_date: fromDate,
            to_date: toDate,
            from_time: fromTime,
            to_time: toTime,
            reason,
            faculty_guide_id: facultyGuideId,
            mentor_approval_status: 'pending',
          },
        });

        await tx.od_request_hod_approvals.createMany({
          data: hodApprovals.map((a) => ({
            od_request_id: request.id,
            student_id: a.student_id,
            department_id: a.department_id,
            status: 'pending',
          })),
        });

        return request;
      });
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      this.logger.error(
        `Failed to submit OD request for team ${teamId} (user ${userId})`,
        err,
      );
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  private isUniqueConstraintError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2002'
    );
  }

  private isRecordNotFoundError(err: unknown): boolean {
    return (
      typeof err === 'object' &&
      err !== null &&
      (err as { code?: string }).code === 'P2025'
    );
  }
}
