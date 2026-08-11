import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { paginate } from '../../../common/dto/pagination.dto';
import { CompaniesService } from '../companies/companies.service';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';
import {
  target_audience_enum,
  drive_application_status_enum,
} from '../../../../generated/prisma/enums';
import { CreateDriveDto } from './dto/create-drive.dto';
import { UpdateDriveDto } from './dto/update-drive.dto';
import { ListDrivesQueryDto } from './dto/list-drives-query.dto';
import { CreateDriveApplicationDto } from './dto/create-drive-application.dto';
import { UpdateDriveApplicationStatusDto } from './dto/update-drive-application-status.dto';

/** Midnight-truncated Date for comparisons against @db.Date columns. */
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

@Injectable()
export class DrivesService {
  private readonly logger = new Logger(DrivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companiesService: CompaniesService,
  ) {}

  async create(user: JwtPayload, dto: CreateDriveDto) {
    await this.companiesService.findOne(dto.company_id);

    const scheduledDate = new Date(dto.scheduled_date);
    if (scheduledDate < today()) {
      throw new BadRequestException('scheduled_date cannot be in the past');
    }

    const isDisclosed = dto.is_disclosed ?? true;
    const revealDate = this.resolveRevealDate(
      isDisclosed,
      dto.disclosed_reveal_date,
      scheduledDate,
    );

    return this.prisma.placement_drives.create({
      data: {
        company_id: dto.company_id,
        scheduled_date: scheduledDate,
        is_disclosed: isDisclosed,
        disclosed_reveal_date: revealDate,
        created_by_user_id: user.sub,
      },
      include: { companies: true },
    });
  }

  async findAll(dto: ListDrivesQueryDto) {
    const where: Record<string, unknown> = {};
    if (dto.company_id) where.company_id = dto.company_id;
    if (dto.status) where.status = dto.status;
    if (dto.upcoming) where.scheduled_date = { gte: today() };

    const [data, total] = await Promise.all([
      this.prisma.placement_drives.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        orderBy: { scheduled_date: 'asc' },
        include: {
          companies: true,
          _count: { select: { student_drive_applications: true } },
        },
      }),
      this.prisma.placement_drives.count({ where }),
    ]);

    return paginate(data, total, dto);
  }

  async findOne(id: number) {
    return this.findOrThrow(id);
  }

  async update(id: number, dto: UpdateDriveDto) {
    const drive = await this.findOrThrow(id);

    if (dto.company_id) await this.companiesService.findOne(dto.company_id);

    const scheduledDate = dto.scheduled_date
      ? new Date(dto.scheduled_date)
      : drive.scheduled_date;

    const isDisclosed = dto.is_disclosed ?? drive.is_disclosed;
    const revealDate = this.resolveRevealDate(
      isDisclosed,
      dto.disclosed_reveal_date ??
        drive.disclosed_reveal_date?.toISOString().slice(0, 10),
      scheduledDate,
    );

    return this.prisma.placement_drives.update({
      where: { id },
      data: {
        company_id: dto.company_id,
        scheduled_date: scheduledDate,
        is_disclosed: isDisclosed,
        disclosed_reveal_date: revealDate,
        status: dto.status,
      },
      include: { companies: true },
    });
  }

  async remove(id: number) {
    await this.findOrThrow(id);

    const applicationCount = await this.prisma.student_drive_applications.count(
      {
        where: { drive_id: id },
      },
    );
    if (applicationCount > 0) {
      throw new ConflictException(
        'Cannot delete a drive that already has student applications',
      );
    }

    await this.prisma.placement_drives.delete({ where: { id } });
    return { id };
  }

  // ───────────────────────────── Applications ─────────────────────────────

  async addApplication(driveId: number, dto: CreateDriveApplicationDto) {
    await this.findOrThrow(driveId);

    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
    });
    if (!student) {
      throw new NotFoundException(`Student ${dto.student_id} not found`);
    }

    const existing = await this.prisma.student_drive_applications.findUnique({
      where: {
        drive_id_student_id: { drive_id: driveId, student_id: dto.student_id },
      },
    });
    if (existing) {
      throw new ConflictException(
        'This student is already mapped to this drive',
      );
    }

    return this.prisma.student_drive_applications.create({
      data: { drive_id: driveId, student_id: dto.student_id },
    });
  }

  async listApplications(driveId: number) {
    await this.findOrThrow(driveId);

    return this.prisma.student_drive_applications.findMany({
      where: { drive_id: driveId },
      include: {
        students: { select: { id: true, student_id_no: true, roll_no: true } },
      },
      orderBy: { updated_at: 'desc' },
    });
  }

  /**
   * last_cleared_round tracks the highest round ever reached, independent
   * of `status` - so it survives a later transition to 'rejected' (which
   * overwrites `status` itself) and can still answer "cleared how far
   * before being rejected?" for the student-facing history view. Only
   * set when the new status actually implies a round was cleared;
   * left untouched (not reset) for every other transition, including
   * 'rejected' itself - that's the whole point.
   */
  private static readonly ROUND_REACHED_BY_STATUS: Partial<
    Record<drive_application_status_enum, number>
  > = {
    r1_cleared: 1,
    r2_cleared: 2,
    r3_cleared: 3,
    placed: 3, // being placed necessarily means every round was cleared
  };

  async updateApplicationStatus(
    user: JwtPayload,
    driveId: number,
    studentId: number,
    dto: UpdateDriveApplicationStatusDto,
  ) {
    const application = await this.findApplicationOrThrow(driveId, studentId);
    const roundReached = DrivesService.ROUND_REACHED_BY_STATUS[dto.status];

    return this.prisma.student_drive_applications.update({
      where: { id: application.id },
      data: {
        status: dto.status,
        ...(roundReached !== undefined ? { last_cleared_round: roundReached } : {}),
        updated_by_user_id: user.sub,
        updated_at: new Date(),
      },
    });
  }

  async removeApplication(driveId: number, studentId: number) {
    const application = await this.findApplicationOrThrow(driveId, studentId);
    await this.prisma.student_drive_applications.delete({
      where: { id: application.id },
    });
    return { driveId, studentId };
  }

  // ───────────────────────────── Student-facing upcoming/history ─────────────────────────────

  /**
   * A student's own outcome (student_drive_applications.status) — not the
   * institution-wide placement_drives.status, which stays 'scheduled' for
   * every drive currently seeded even once individual students have been
   * marked placed/rejected on it — is what separates "still waiting on a
   * result" from "done" for that student: placed/rejected -> history,
   * anything else (applied/r1_cleared/r2_cleared/r3_cleared) -> upcoming.
   */
  private static readonly CONCLUDED_APPLICATION_STATUSES = [
    'rejected',
    'placed',
  ] as const;

  /** GET /drives/student/upcoming — drives still in progress (not yet placed/rejected) for this student. */
  async getUpcomingForStudent(user: JwtPayload) {
    const student = await this.findStudentOrThrow(user.sub);
    return this.getUpcomingForStudentId(student.id);
  }

  /** Parent-facing (GET /me/children/:studentId/upcoming-drives) — same shape, resolved for an explicit studentId. */
  async getUpcomingForStudentId(studentId: number) {
    const applications = await this.prisma.student_drive_applications.findMany(
      {
        where: {
          student_id: studentId,
          status: { notIn: [...DrivesService.CONCLUDED_APPLICATION_STATUSES] },
        },
        include: { placement_drives: { include: { companies: true } } },
        orderBy: { placement_drives: { scheduled_date: 'asc' } },
      },
    );

    return applications.map((app) => this.toUpcomingDrive(app));
  }

  /** GET /drives/student/history — drives where this student has a final outcome (placed/rejected). */
  async getHistoryForStudent(user: JwtPayload) {
    const student = await this.findStudentOrThrow(user.sub);
    return this.buildHistoryForStudentId(student.id);
  }

  /** Parent-facing (GET /me/children/:studentId/placement-history) — same shape/logic as the student's own history. */
  async getPlacementHistoryForStudentId(studentId: number) {
    return this.buildHistoryForStudentId(studentId);
  }

  private async buildHistoryForStudentId(studentId: number) {
    const applications = await this.prisma.student_drive_applications.findMany(
      {
        where: {
          student_id: studentId,
          status: { in: [...DrivesService.CONCLUDED_APPLICATION_STATUSES] },
        },
        include: { placement_drives: { include: { companies: true } } },
        orderBy: { updated_at: 'desc' },
      },
    );

    return applications.map((app) => {
      const drive = app.placement_drives;
      return {
        drive_id: drive.id,
        company_name: this.resolveCompanyName(drive),
        scheduled_date: drive.scheduled_date,
        drive_status: drive.status,
        job_role: drive.job_role,
        package_lpa: drive.package_lpa === null ? null : Number(drive.package_lpa),
        application_status: app.status,
        last_cleared_round: app.last_cleared_round,
      };
    });
  }

  /**
   * GET /drives/for-calendar (Principal only) - every real placement
   * drive's scheduled_date, masked the same way as every other
   * disclosed/undisclosed view in this service - feeds the Principal's
   * merged academic calendar (see PrincipalCalendarScreen on the frontend,
   * which merges this with GET /me/academic-calendar-institution).
   * Institution-wide and status-agnostic - a Principal wants every real
   * drive mapped, not just ones still in progress.
   */
  async getAllDrivesForCalendar() {
    const drives = await this.prisma.placement_drives.findMany({
      include: { companies: true },
      orderBy: { scheduled_date: 'asc' },
    });

    return drives.map((drive) => ({
      drive_id: drive.id,
      company_name: this.resolveCompanyName(drive),
      scheduled_date: drive.scheduled_date,
    }));
  }

  // ───────────────────────────── Faculty (mentor) view ─────────────────────────────

  /**
   * GET /me/upcoming-drives (Faculty only) — every drive that hasn't
   * concluded yet, institution-wide (not scoped to any particular
   * student). No status field at all: unlike the student-facing upcoming
   * list, a faculty isn't an applicant on these drives, so there's no
   * per-application outcome to attach - just the drive itself, respecting
   * the same disclosed/undisclosed masking as everywhere else.
   */
  async getUpcomingDrivesForFaculty() {
    const drives = await this.prisma.placement_drives.findMany({
      where: { status: 'scheduled' },
      include: { companies: true },
      orderBy: { scheduled_date: 'asc' },
    });

    return drives.map((drive) => ({
      drive_id: drive.id,
      company_name: this.resolveCompanyName(drive),
      company_profile_info: drive.is_disclosed ? drive.companies.profile_info : null,
      scheduled_date: drive.scheduled_date,
      is_disclosed: drive.is_disclosed,
      disclosed_reveal_date: drive.is_disclosed ? null : drive.disclosed_reveal_date,
    }));
  }

  /**
   * GET /me/mentored-students (Faculty only) — every student in a class
   * the caller mentors, via class_mentors - same scoping pattern as
   * StudentLeavesService/StudentOdsService. A faculty who mentors no class
   * gets an empty list rather than an error. Feeds the Placements History
   * tab's "pick a mentee, then see their placement history" flow.
   */
  async getMentoredStudents(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mentorClasses = await this.prisma.class_mentors.findMany({
      where: { faculty_id: faculty.id },
      select: { class_id: true },
    });
    const classIds = mentorClasses.map((m) => m.class_id);
    if (classIds.length === 0) return [];

    const students = await this.prisma.students.findMany({
      where: { class_id: { in: classIds } },
      select: {
        id: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
        classes: {
          select: { section: true, departments: { select: { name: true } } },
        },
      },
      orderBy: { student_id_no: 'asc' },
    });

    return students.map((s) => ({
      student_id: s.id,
      student_id_no: s.student_id_no,
      name: this.resolveStudentDisplayName(s),
      section: s.classes?.section ?? null,
      department_name: s.classes?.departments.name ?? null,
    }));
  }

  /**
   * GET /me/mentored-students/:studentId/placement-history (Faculty only —
   * mentor of that student's class). Same shape/logic as the student's own
   * GET /drives/student/history, just resolved for an explicit studentId
   * instead of the caller - see buildHistoryForStudentId().
   */
  async getStudentPlacementHistoryForMentor(studentId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { id: true, class_id: true },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }

    const mentorMapping =
      student.class_id !== null
        ? await this.prisma.class_mentors.findFirst({
            where: { class_id: student.class_id, faculty_id: faculty.id },
          })
        : null;
    if (!mentorMapping) {
      throw new ForbiddenException(
        "You are not the mentor for this student's class",
      );
    }

    return this.buildHistoryForStudentId(studentId);
  }

  // ───────────────────────────── Principal (any department) view ─────────────────────────────

  /**
   * GET /drives/department/:departmentId/upcoming (Placement/Admin/Principal)
   * — every student in the given department with a still-in-progress
   * application, unlike the HoD view below this is NOT resolved from the
   * caller's own faculty row - a Principal picks any department via a
   * dropdown, so the id is taken as given (see assertDepartmentExists).
   */
  async getUpcomingForDepartment(departmentId: number) {
    await this.assertDepartmentExists(departmentId);

    const applications = await this.prisma.student_drive_applications.findMany(
      {
        where: {
          status: { notIn: [...DrivesService.CONCLUDED_APPLICATION_STATUSES] },
          students: { classes: { department_id: departmentId } },
        },
        include: {
          placement_drives: { include: { companies: true } },
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { section: true } },
            },
          },
        },
        orderBy: { placement_drives: { scheduled_date: 'asc' } },
      },
    );

    return applications.map((app) => ({
      ...this.toUpcomingDrive(app),
      student: this.toStudentSummary(app.students),
    }));
  }

  /**
   * GET /drives/department/:departmentId/history (Placement/Admin/Principal)
   * — same split as buildHistoryForStudentId, aggregated across every
   * student in the given department instead of one student at a time.
   */
  async getHistoryForDepartment(departmentId: number) {
    await this.assertDepartmentExists(departmentId);

    const applications = await this.prisma.student_drive_applications.findMany(
      {
        where: {
          status: { in: [...DrivesService.CONCLUDED_APPLICATION_STATUSES] },
          students: { classes: { department_id: departmentId } },
        },
        include: {
          placement_drives: { include: { companies: true } },
          students: {
            select: {
              id: true,
              student_id_no: true,
              soa_applications: { select: { first_name: true, last_name: true } },
              users: { select: { email: true } },
              classes: { select: { section: true } },
            },
          },
        },
        orderBy: { updated_at: 'desc' },
      },
    );

    return applications.map((app) => {
      const drive = app.placement_drives;
      return {
        drive_id: drive.id,
        company_name: this.resolveCompanyName(drive),
        scheduled_date: drive.scheduled_date,
        drive_status: drive.status,
        application_status: app.status,
        last_cleared_round: app.last_cleared_round,
        student: this.toStudentSummary(app.students),
      };
    });
  }

  private async assertDepartmentExists(departmentId: number) {
    const department = await this.prisma.departments.findUnique({
      where: { id: departmentId },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
  }

  private toStudentSummary(student: {
    id: number;
    student_id_no: string;
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
    classes: { section: string } | null;
  }) {
    return {
      id: student.id,
      student_id_no: student.student_id_no,
      name: this.resolveStudentDisplayName(student),
      section: student.classes?.section ?? null,
    };
  }

  // ───────────────────────────── HoD (department) view ─────────────────────────────

  /**
   * GET /me/department-classes (HoD only) — every class in the HoD's own
   * department, for the class-selector on the Placements History tab.
   * Ordered most-recent-batch-first, same reasoning as
   * AssignmentsService.getHandledClasses: a department running the same
   * course across several successive batches almost always wants the
   * currently-running one surfaced first.
   */
  async getDepartmentClasses(userId: number) {
    const hod = await this.resolveFacultyByUserId(userId);

    const classes = await this.prisma.classes.findMany({
      where: { department_id: hod.department_id },
      select: {
        id: true,
        section: true,
        current_semester: true,
        batches: { select: { name: true, start_year: true } },
        courses: { select: { name: true, code: true } },
      },
      orderBy: [{ batches: { start_year: 'desc' } }, { section: 'asc' }],
    });

    return classes.map((c) => ({
      class_id: c.id,
      section: c.section,
      semester: c.current_semester,
      batch_name: c.batches.name,
      course_name: c.courses.name,
      course_code: c.courses.code,
    }));
  }

  /**
   * GET /me/department-students (HoD only) — every student in every class
   * of the HoD's own department (via their own faculty row's
   * department_id), not just classes the HoD personally mentors - the same
   * "pick a student, see their placement history" flow as the faculty
   * mentor view, just scoped one level up. A HoD whose department has no
   * classes yet gets an empty list rather than an error.
   *
   * `classId` optionally narrows this down to one class (the Placements
   * History tab's class selector) - must belong to the HoD's own
   * department, checked explicitly rather than silently ignored.
   */
  async getDepartmentStudents(userId: number, classId?: number) {
    const hod = await this.resolveFacultyByUserId(userId);

    let classIds: number[];
    if (classId !== undefined) {
      const cls = await this.prisma.classes.findUnique({
        where: { id: classId },
        select: { department_id: true },
      });
      if (!cls || cls.department_id !== hod.department_id) {
        throw new ForbiddenException('This class is not in your department');
      }
      classIds = [classId];
    } else {
      const departmentClasses = await this.prisma.classes.findMany({
        where: { department_id: hod.department_id },
        select: { id: true },
      });
      classIds = departmentClasses.map((c) => c.id);
    }
    if (classIds.length === 0) return [];

    const students = await this.prisma.students.findMany({
      where: { class_id: { in: classIds } },
      select: {
        id: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
        classes: {
          select: { section: true, departments: { select: { name: true } } },
        },
      },
      orderBy: { student_id_no: 'asc' },
    });

    return students.map((s) => ({
      student_id: s.id,
      student_id_no: s.student_id_no,
      name: this.resolveStudentDisplayName(s),
      section: s.classes?.section ?? null,
      department_name: s.classes?.departments.name ?? null,
    }));
  }

  /**
   * GET /me/department-students/:studentId/placement-history (HoD only —
   * student's class must belong to the HoD's own department). Same
   * shape/logic as the mentor version, just department-scoped instead of
   * class_mentors-scoped - see buildHistoryForStudentId().
   */
  async getStudentPlacementHistoryForHod(studentId: number, userId: number) {
    const hod = await this.resolveFacultyByUserId(userId);

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: { id: true, classes: { select: { department_id: true } } },
    });
    if (!student) {
      throw new NotFoundException('Student not found');
    }
    if (!student.classes || student.classes.department_id !== hod.department_id) {
      throw new ForbiddenException(
        'This student is not in your department',
      );
    }

    return this.buildHistoryForStudentId(studentId);
  }

  /** No generic "display name" column on `students` - same fallback chain used across every other faculty-facing module in this codebase. */
  private resolveStudentDisplayName(student: {
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
  }): string {
    if (student.soa_applications) {
      const { first_name, last_name } = student.soa_applications;
      return last_name ? `${first_name} ${last_name}` : first_name;
    }
    return student.users.email;
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

  private toUpcomingDrive(app: {
    status: string;
    last_cleared_round: number | null;
    placement_drives: {
      id: number;
      scheduled_date: Date;
      is_disclosed: boolean;
      disclosed_reveal_date: Date | null;
      job_role: string | null;
      package_lpa: Prisma.Decimal | null;
      companies: { name: string; profile_info: string | null };
    };
  }) {
    const drive = app.placement_drives;
    return {
      drive_id: drive.id,
      company_name: this.resolveCompanyName(drive),
      company_profile_info: drive.is_disclosed ? drive.companies.profile_info : null,
      scheduled_date: drive.scheduled_date,
      is_disclosed: drive.is_disclosed,
      disclosed_reveal_date: drive.is_disclosed ? null : drive.disclosed_reveal_date,
      job_role: drive.job_role,
      package_lpa: drive.package_lpa === null ? null : Number(drive.package_lpa),
      application_status: app.status,
      last_cleared_round: app.last_cleared_round,
    };
  }

  private resolveCompanyName(drive: {
    is_disclosed: boolean;
    companies: { name: string };
  }): string {
    return drive.is_disclosed ? drive.companies.name : 'Undisclosed';
  }

  private async findStudentOrThrow(userId: number) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
    });
    if (!student) {
      throw new NotFoundException(
        'Student profile not found for the current user',
      );
    }
    return student;
  }

  // ───────────────────────────── Automation ─────────────────────────────

  /** Auto-reveals undisclosed companies once their reveal date arrives, and posts the day-before announcement. */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async runDailyAutomation() {
    await this.revealDueCompanies();
    await this.announceTomorrowsDrives();
  }

  private async revealDueCompanies() {
    const { count } = await this.prisma.placement_drives.updateMany({
      where: { is_disclosed: false, disclosed_reveal_date: { lte: today() } },
      data: { is_disclosed: true },
    });
    if (count > 0) {
      this.logger.log(
        `Revealed ${count} placement drive compan${count === 1 ? 'y' : 'ies'}`,
      );
    }
  }

  private async announceTomorrowsDrives() {
    const tomorrow = new Date(today());
    tomorrow.setDate(tomorrow.getDate() + 1);

    const drives = await this.prisma.placement_drives.findMany({
      where: {
        scheduled_date: tomorrow,
        notification_sent_at: null,
        created_by_user_id: { not: null },
      },
      include: { companies: true },
    });

    for (const drive of drives) {
      const companyLabel = drive.is_disclosed
        ? drive.companies.name
        : 'A company';
      await this.prisma.announcements.create({
        data: {
          posted_by_user_id: drive.created_by_user_id as number,
          title: 'Placement Drive Tomorrow',
          content: `${companyLabel} is conducting a placement drive tomorrow (${drive.scheduled_date.toISOString().slice(0, 10)}).`,
          target_audience: target_audience_enum.students,
        },
      });

      await this.prisma.placement_drives.update({
        where: { id: drive.id },
        data: { notification_sent_at: new Date() },
      });
    }

    if (drives.length > 0) {
      this.logger.log(
        `Posted ${drives.length} day-before drive announcement(s)`,
      );
    }
  }

  // ───────────────────────────── Helpers ─────────────────────────────

  private resolveRevealDate(
    isDisclosed: boolean,
    revealDate: string | undefined,
    scheduledDate: Date,
  ): Date | null {
    if (isDisclosed) return null;

    if (!revealDate) {
      throw new BadRequestException(
        'disclosed_reveal_date is required when is_disclosed is false',
      );
    }

    const parsed = new Date(revealDate);
    if (parsed >= scheduledDate) {
      throw new BadRequestException(
        'disclosed_reveal_date must be before scheduled_date',
      );
    }

    return parsed;
  }

  private async findOrThrow(id: number) {
    const drive = await this.prisma.placement_drives.findUnique({
      where: { id },
    });
    if (!drive) throw new NotFoundException(`Drive ${id} not found`);
    return drive;
  }

  private async findApplicationOrThrow(driveId: number, studentId: number) {
    const application = await this.prisma.student_drive_applications.findUnique(
      {
        where: {
          drive_id_student_id: { drive_id: driveId, student_id: studentId },
        },
      },
    );
    if (!application) {
      throw new NotFoundException(
        `No application found for student ${studentId} on drive ${driveId}`,
      );
    }
    return application;
  }
}
