import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../../prisma/prisma.service';
import { Prisma } from '../../../../generated/prisma/client';
import { NotificationsService } from '../../notifications/notifications/notifications.service';
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
import type { CareerPath } from '../../admissions/students/me-profile/dto/update-career-path.dto';
import type { ReportTable } from './report-export.util';

/** Midnight-truncated Date for comparisons against @db.Date columns. */
function today(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

interface DriveExtras {
  mode: string | null;
  backlogs_allowed: string | null;
  eligible_department_codes: string | null;
  round1_label: string | null;
  round2_label: string | null;
  round3_label: string | null;
  result_declaration_note: string | null;
}

const NO_DRIVE_EXTRAS: DriveExtras = {
  mode: null,
  backlogs_allowed: null,
  eligible_department_codes: null,
  round1_label: null,
  round2_label: null,
  round3_label: null,
  result_declaration_note: null,
};

interface OfferExtras {
  joining_date: Date | null;
  work_location: string | null;
}

const NO_OFFER_EXTRAS: OfferExtras = {
  joining_date: null,
  work_location: null,
};

interface PlacementFlags {
  placement_eligible: boolean | null;
  placement_opted_out: boolean;
}

const NO_PLACEMENT_FLAGS: PlacementFlags = {
  placement_eligible: null,
  placement_opted_out: false,
};

@Injectable()
export class DrivesService {
  private readonly logger = new Logger(DrivesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly companiesService: CompaniesService,
    private readonly notifications: NotificationsService,
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

    const created = await this.prisma.placement_drives.create({
      data: {
        company_id: dto.company_id,
        scheduled_date: scheduledDate,
        is_disclosed: isDisclosed,
        disclosed_reveal_date: revealDate,
        created_by_user_id: user.sub,
        job_role: dto.job_role,
        package_lpa: dto.package_lpa,
        eligibility_cgpa: dto.eligibility_cgpa,
        venue: dto.venue,
        registration_start: dto.registration_start
          ? new Date(dto.registration_start)
          : undefined,
        registration_end: dto.registration_end
          ? new Date(dto.registration_end)
          : undefined,
      },
      include: { companies: true },
    });

    await this.writeDriveExtras(created.id, dto);
    const extras = await this.loadDriveExtras(created.id);
    return { ...created, ...extras };
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

  // One row per drive with real, computed round-progress stats — powers the
  // Placement Drives list. Unpaginated (small real dataset) so the frontend
  // can search/sort/paginate client-side, same as the students/companies
  // report endpoints.
  async getDriveReport() {
    const [drives, extras] = await Promise.all([
      this.prisma.placement_drives.findMany({
        orderBy: { scheduled_date: 'desc' },
        include: {
          companies: { select: { name: true } },
          student_drive_applications: {
            select: { status: true, last_cleared_round: true },
          },
        },
      }),
      this.loadAllDriveExtras(),
    ]);

    const now = today();
    return drives.map((d) => {
      const apps = d.student_drive_applications;
      const applied = apps.length;
      const shortlisted = apps.filter(
        (a) => (a.last_cleared_round ?? 0) >= 1 || a.status === 'placed',
      ).length;
      const selected = apps.filter((a) => a.status === 'placed').length;
      const conversionPct =
        applied > 0 ? Math.round((selected / applied) * 100) : 0;
      const displayStatus =
        d.status === 'completed'
          ? 'completed'
          : d.status === 'cancelled'
            ? 'cancelled'
            : d.scheduled_date > now
              ? 'upcoming'
              : 'ongoing';
      const rowExtras = extras.get(d.id) ?? NO_DRIVE_EXTRAS;

      return {
        id: d.id,
        company_name: d.companies.name,
        job_role: d.job_role,
        scheduled_date: d.scheduled_date,
        package_lpa: d.package_lpa != null ? Number(d.package_lpa) : null,
        mode: rowExtras.mode,
        applied,
        shortlisted,
        selected,
        conversion_pct: conversionPct,
        status: d.status,
        display_status: displayStatus,
      };
    });
  }

  async findOne(id: number) {
    const drive = await this.prisma.placement_drives.findUnique({
      where: { id },
      include: {
        companies: true,
        student_drive_applications: {
          select: { status: true, last_cleared_round: true },
        },
      },
    });
    if (!drive) throw new NotFoundException(`Drive ${id} not found`);

    const { student_drive_applications: apps, ...driveFields } = drive;
    const applied = apps.length;
    const shortlisted = apps.filter(
      (a) => (a.last_cleared_round ?? 0) >= 1 || a.status === 'placed',
    ).length;
    const interviewed = apps.filter(
      (a) => (a.last_cleared_round ?? 0) >= 2 || a.status === 'placed',
    ).length;
    const selected = apps.filter((a) => a.status === 'placed').length;
    const now = today();
    const displayStatus =
      driveFields.status === 'completed'
        ? 'completed'
        : driveFields.status === 'cancelled'
          ? 'cancelled'
          : driveFields.scheduled_date > now
            ? 'upcoming'
            : 'ongoing';
    const extras = await this.loadDriveExtras(id);

    return {
      ...driveFields,
      applied_count: applied,
      shortlisted_count: shortlisted,
      interviewed_count: interviewed,
      selected_count: selected,
      display_status: displayStatus,
      ...extras,
    };
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

    const updated = await this.prisma.placement_drives.update({
      where: { id },
      data: {
        company_id: dto.company_id,
        scheduled_date: scheduledDate,
        is_disclosed: isDisclosed,
        disclosed_reveal_date: revealDate,
        status: dto.status,
        job_role: dto.job_role,
        package_lpa: dto.package_lpa,
        eligibility_cgpa: dto.eligibility_cgpa,
        venue: dto.venue,
        registration_start: dto.registration_start
          ? new Date(dto.registration_start)
          : undefined,
        registration_end: dto.registration_end
          ? new Date(dto.registration_end)
          : undefined,
      },
      include: { companies: true },
    });

    await this.writeDriveExtras(id, dto);
    const extras = await this.loadDriveExtras(id);
    return { ...updated, ...extras };
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

  /**
   * Bulk-adds students to a drive from a list of identifiers (student ID or
   * roll number) parsed from an uploaded file — for shortlists the
   * placement team gets from a company as a spreadsheet, instead of adding
   * each student one at a time.
   */
  async importApplications(driveId: number, identifiers: string[]) {
    await this.findOrThrow(driveId);

    const students = await this.prisma.students.findMany({
      where: {
        OR: [
          { student_id_no: { in: identifiers } },
          { roll_no: { in: identifiers } },
        ],
      },
      select: { id: true, student_id_no: true, roll_no: true },
    });

    const studentIdByIdentifier = new Map<string, number>();
    for (const s of students) {
      studentIdByIdentifier.set(s.student_id_no, s.id);
      if (s.roll_no) studentIdByIdentifier.set(s.roll_no, s.id);
    }

    const existing = await this.prisma.student_drive_applications.findMany({
      where: {
        drive_id: driveId,
        student_id: { in: students.map((s) => s.id) },
      },
      select: { student_id: true },
    });
    const alreadyAddedIds = new Set(existing.map((a) => a.student_id));

    const notFound: string[] = [];
    const alreadyAdded: string[] = [];
    const seen = new Set<number>();
    const toCreate: number[] = [];

    for (const identifier of identifiers) {
      const studentId = studentIdByIdentifier.get(identifier);
      if (!studentId) {
        notFound.push(identifier);
        continue;
      }
      if (alreadyAddedIds.has(studentId) || seen.has(studentId)) {
        alreadyAdded.push(identifier);
        continue;
      }
      seen.add(studentId);
      toCreate.push(studentId);
    }

    if (toCreate.length > 0) {
      await this.prisma.student_drive_applications.createMany({
        data: toCreate.map((studentId) => ({
          drive_id: driveId,
          student_id: studentId,
        })),
      });
    }

    return {
      added: toCreate.length,
      already_added: alreadyAdded,
      not_found: notFound,
    };
  }

  async listApplications(driveId: number) {
    await this.findOrThrow(driveId);

    return this.prisma.student_drive_applications.findMany({
      where: { drive_id: driveId },
      include: {
        students: {
          select: {
            id: true,
            student_id_no: true,
            roll_no: true,
            classes: {
              select: {
                section: true,
                departments: { select: { name: true, code: true } },
              },
            },
            soa_applications: {
              select: { first_name: true, last_name: true },
            },
          },
        },
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
    const roundReached =
      dto.status !== undefined
        ? DrivesService.ROUND_REACHED_BY_STATUS[dto.status]
        : undefined;

    const updated = await this.prisma.student_drive_applications.update({
      where: { id: application.id },
      data: {
        status: dto.status,
        ...(roundReached !== undefined
          ? { last_cleared_round: roundReached }
          : {}),
        offer_response: dto.offer_response,
        offered_package: dto.offered_package_lpa,
        updated_by_user_id: user.sub,
        updated_at: new Date(),
      },
    });

    // joining_date/work_location are real once query.md #16 runs — read/
    // written via `$queryRaw` since they predate a `prisma db pull`; this
    // silently no-ops (not thrown) when the columns don't exist yet.
    if (dto.joining_date !== undefined || dto.work_location !== undefined) {
      try {
        await this.prisma.$executeRaw`
          UPDATE student_drive_applications SET
            joining_date = COALESCE(${dto.joining_date ?? null}::date, joining_date),
            work_location = COALESCE(${dto.work_location ?? null}, work_location)
          WHERE id = ${application.id}
        `;
      } catch {
        // columns don't exist yet — query.md #16 not run; silently degrade.
      }
    }

    // dto.status is optional (offer_response/offered_package_lpa can be
    // updated on their own, e.g. from the Offers page) - only notify when a
    // status transition actually happened.
    if (dto.status !== undefined) {
      await this.notifyApplicationStatusUpdated(studentId, driveId, dto.status);
    }

    return updated;
  }

  /** Never throws - the application update above has already committed by this point. */
  private async notifyApplicationStatusUpdated(
    studentId: number,
    driveId: number,
    status: string,
  ): Promise<void> {
    try {
      const student = await this.prisma.students.findUnique({
        where: { id: studentId },
        select: { user_id: true },
      });
      if (!student) return;

      const drive = await this.prisma.placement_drives.findUnique({
        where: { id: driveId },
        select: { companies: { select: { name: true } } },
      });

      await this.notifications.notify({
        user_id: student.user_id,
        title: 'Placement application status updated',
        message: `Your application${drive ? ` for ${drive.companies.name}` : ''} is now: ${status}.`,
        type: 'placement_status_updated',
        related_entity_type: 'drive_application',
        related_entity_id: driveId,
      });
    } catch (err) {
      this.logger.error(
        `Failed to notify student ${studentId} of drive ${driveId} status update`,
        err,
      );
    }
  }

  async removeApplication(driveId: number, studentId: number) {
    const application = await this.findApplicationOrThrow(driveId, studentId);
    await this.prisma.student_drive_applications.delete({
      where: { id: application.id },
    });
    return { driveId, studentId };
  }

  // ───────────────────────────── Aggregates (Dashboard/Reports/Offers) ─────────────────────────────

  private static readonly NON_TERMINAL_STATUSES = new Set([
    'applied',
    'r1_cleared',
    'r2_cleared',
    'r3_cleared',
  ]);
  private static readonly UNASSIGNED = 'Unassigned';

  /** All batches, for the Reports page's batch filter — newest first. */
  async getBatches() {
    return this.prisma.batches.findMany({
      select: { id: true, name: true, start_year: true, end_year: true },
      orderBy: { end_year: 'desc' },
    });
  }

  /**
   * Every student with their placement participation summary — whether
   * they've applied to any drive, and if so, how far they've progressed.
   * Two queries total (full roster + full application list), joined in
   * memory, instead of one request per student.
   */
  async getStudentReport(batchId?: number) {
    const [students, applications, placementFlags, careerPaths] =
      await Promise.all([
        this.prisma.students.findMany({
          where: batchId ? { batch_id: batchId } : undefined,
          select: {
            id: true,
            student_id_no: true,
            roll_no: true,
            register_no: true,
            classes: {
              select: {
                section: true,
                current_semester: true,
                departments: { select: { name: true, code: true } },
              },
            },
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
          },
          orderBy: { student_id_no: 'asc' },
        }),
        this.prisma.student_drive_applications.findMany({
          select: {
            student_id: true,
            status: true,
            last_cleared_round: true,
            updated_at: true,
            offer_response: true,
            placement_drives: {
              select: { companies: { select: { name: true } } },
            },
          },
        }),
        this.loadAllPlacementFlags(),
        this.loadAllCareerPaths(),
      ]);

    const appsByStudent = new Map<number, typeof applications>();
    for (const a of applications) {
      const list = appsByStudent.get(a.student_id) ?? [];
      list.push(a);
      appsByStudent.set(a.student_id, list);
    }

    const progressRank = (a: (typeof applications)[number]) =>
      a.status === 'placed' ? 100 : (a.last_cleared_round ?? 0);

    return students.map((s) => {
      const apps = appsByStudent.get(s.id) ?? [];
      const best = apps.length
        ? apps.reduce((a, b) => (progressRank(b) > progressRank(a) ? b : a))
        : null;
      const soa = s.soa_applications;
      const offersCount = apps.filter(
        (a) => a.status === 'placed' || a.offer_response != null,
      ).length;
      const flags = placementFlags.get(s.id) ?? NO_PLACEMENT_FLAGS;

      return {
        id: s.id,
        student_id_no: s.student_id_no,
        roll_no: s.roll_no,
        register_no: s.register_no,
        placement_eligible: flags.placement_eligible,
        placement_opted_out: flags.placement_opted_out,
        career_path: careerPaths.get(s.id) ?? null,
        name:
          soa?.first_name || soa?.last_name
            ? [soa?.first_name, soa?.last_name].filter(Boolean).join(' ')
            : s.users.email,
        class_label: s.classes
          ? `${s.classes.departments.code} - ${s.classes.section}`
          : null,
        department_name: s.classes?.departments.name ?? null,
        department_code: s.classes?.departments.code ?? null,
        // III/IV year etc — derived from the real timetable semester
        // (1-2 → Year I ... 7-8 → Year IV), null if the student has no
        // class assignment yet.
        year:
          s.classes?.current_semester != null
            ? Math.ceil(s.classes.current_semester / 2)
            : null,
        drives_applied: apps.length,
        offers_count: offersCount,
        status: best?.status ?? null,
        last_cleared_round: best?.last_cleared_round ?? null,
        company_name: best?.placement_drives.companies.name ?? null,
      };
    });
  }

  /**
   * Every drive, cross-referenced against one student's applications —
   * "attended or not, and if attended, what status" for each drive that
   * exists, not just the ones they applied to. Backs the Student Reports
   * detail view.
   */
  async getStudentDriveHistory(studentId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException(`Student ${studentId} not found`);
    }

    const [drives, applications] = await Promise.all([
      this.prisma.placement_drives.findMany({
        select: {
          id: true,
          scheduled_date: true,
          is_disclosed: true,
          job_role: true,
          companies: { select: { name: true } },
        },
        orderBy: { scheduled_date: 'desc' },
      }),
      this.prisma.student_drive_applications.findMany({
        where: { student_id: studentId },
        select: {
          drive_id: true,
          status: true,
          last_cleared_round: true,
          offer_response: true,
          offered_package: true,
        },
      }),
    ]);

    const appByDrive = new Map(applications.map((a) => [a.drive_id, a]));

    return drives.map((d) => {
      const app = appByDrive.get(d.id);
      return {
        drive_id: d.id,
        company_name: d.is_disclosed ? d.companies.name : 'Undisclosed',
        scheduled_date: d.scheduled_date,
        job_role: d.job_role,
        attended: !!app,
        status: app?.status ?? null,
        last_cleared_round: app?.last_cleared_round ?? null,
        offer_response: app?.offer_response ?? null,
        offered_package: app?.offered_package ?? null,
      };
    });
  }

  private static readonly STATUS_LABEL: Record<string, string> = {
    applied: 'Applied',
    r1_cleared: 'R1 cleared',
    r2_cleared: 'R2 cleared',
    r3_cleared: 'R3 cleared',
    rejected: 'Rejected',
    placed: 'Placed',
  };

  /**
   * Builds the exportable table for the Student Reports page — optionally
   * scoped to one class (the same drill-down the page's own filter uses),
   * so the exported file matches whatever's on screen.
   */
  async buildStudentReportTable(
    batchId: number | undefined,
    classLabel?: string,
  ): Promise<ReportTable> {
    const allRows = await this.getStudentReport(batchId);
    const rows = classLabel
      ? allRows.filter((r) => r.class_label === classLabel)
      : allRows;

    const batch = batchId
      ? await this.prisma.batches.findUnique({
          where: { id: batchId },
          select: { name: true },
        })
      : null;
    const subtitleParts = [batch ? `Batch ${batch.name}` : 'All batches'];
    if (classLabel) subtitleParts.push(`Class ${classLabel}`);

    const attended = rows.filter((r) => r.drives_applied > 0).length;

    return {
      title: classLabel ? `Student Report — ${classLabel}` : 'Student Report',
      subtitle: subtitleParts.join(' · '),
      summary: [
        { label: 'Total students', value: String(rows.length) },
        { label: 'Attended', value: String(attended) },
        { label: 'Not attended', value: String(rows.length - attended) },
      ],
      columns: [
        { header: 'Student', key: 'student' },
        { header: 'Class', key: 'class_label' },
        { header: 'Department', key: 'department_name' },
        { header: 'Attended', key: 'attended' },
        { header: 'Status', key: 'status' },
        { header: 'Company', key: 'company_name' },
      ],
      rows: rows.map((r) => ({
        student: `${r.name ?? r.student_id_no} (${r.student_id_no})`,
        class_label: r.class_label ?? '—',
        department_name: r.department_name ?? '—',
        attended: r.drives_applied > 0 ? 'Yes' : 'No',
        status: r.status ? DrivesService.STATUS_LABEL[r.status] : '—',
        company_name: r.company_name ?? '—',
      })),
    };
  }

  /**
   * Everything the Dashboard and Reports pages need, computed in a handful
   * of queries instead of the client walking every drive's applications
   * one HTTP request at a time (previously ~50+ requests per page load —
   * enough to trip the global rate limiter and exhaust the DB connection
   * pool). All grouping/math happens here in memory.
   */
  async getPlacementStats(batchId?: number) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekFromNow = new Date(today);
    weekFromNow.setDate(weekFromNow.getDate() + 7);

    const [
      companies,
      drives,
      applications,
      students,
      batches,
      allStudentsForTrend,
    ] = await Promise.all([
      this.prisma.companies.findMany({ select: { created_at: true } }),
      this.prisma.placement_drives.findMany({
        select: {
          id: true,
          status: true,
          scheduled_date: true,
          is_disclosed: true,
          job_role: true,
          package_lpa: true,
          companies: { select: { name: true } },
        },
      }),
      this.prisma.student_drive_applications.findMany({
        select: {
          drive_id: true,
          student_id: true,
          status: true,
          updated_at: true,
          offered_package: true,
          last_cleared_round: true,
          offer_response: true,
        },
      }),
      this.prisma.students.findMany({
        where: batchId ? { batch_id: batchId } : undefined,
        select: {
          id: true,
          classes: {
            select: {
              section: true,
              departments: { select: { name: true, code: true } },
            },
          },
        },
      }),
      // Unscoped by batchId (unlike `students` above) — six-year trend
      // needs every batch's own cohort regardless of the report filter.
      this.prisma.batches.findMany({
        orderBy: { start_year: 'desc' },
        take: 6,
        select: { id: true, name: true, start_year: true, end_year: true },
      }),
      this.prisma.students.findMany({ select: { id: true, batch_id: true } }),
    ]);

    const driveById = new Map(drives.map((d) => [d.id, d]));
    const activeDrives = drives.filter((d) => d.status === 'scheduled');
    const drivesClosingThisWeek = activeDrives.filter(
      (d) => d.scheduled_date >= today && d.scheduled_date <= weekFromNow,
    ).length;

    const appsByDrive = new Map<number, typeof applications>();
    for (const a of applications) {
      const list = appsByDrive.get(a.drive_id) ?? [];
      list.push(a);
      appsByDrive.set(a.drive_id, list);
    }

    let studentsInProcess = 0;
    let studentsInProcessDriveCount = 0;
    let studentsPlaced = 0;
    const monthBuckets = new Map<string, { label: string; count: number }>();
    const placedPackagesByStudent = new Map<number, number[]>();

    for (const [driveId, apps] of appsByDrive) {
      const drive = driveById.get(driveId);
      const inProcess = apps.filter((a) =>
        DrivesService.NON_TERMINAL_STATUSES.has(a.status),
      );
      if (inProcess.length > 0) studentsInProcessDriveCount += 1;
      studentsInProcess += inProcess.length;

      const placed = apps.filter((a) => a.status === 'placed');
      studentsPlaced += placed.length;
      // The advertised drive package is only a fallback — the officer's
      // actual per-student offered_package (entered on the Offers page)
      // takes priority everywhere a package figure is shown once it's set.
      const drivePackageLpa = drive?.package_lpa
        ? Number(drive.package_lpa)
        : undefined;

      for (const p of placed) {
        const key = `${p.updated_at.getFullYear()}-${String(p.updated_at.getMonth() + 1).padStart(2, '0')}`;
        const label = p.updated_at.toLocaleDateString('en-IN', {
          month: 'short',
        });
        monthBuckets.set(key, {
          label,
          count: (monthBuckets.get(key)?.count ?? 0) + 1,
        });

        const effectivePackage = p.offered_package
          ? Number(p.offered_package)
          : drivePackageLpa;
        const packages = placedPackagesByStudent.get(p.student_id) ?? [];
        if (effectivePackage !== undefined) packages.push(effectivePackage);
        placedPackagesByStudent.set(p.student_id, packages);
      }
    }

    const offersByMonth = Array.from(monthBuckets.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([, v]) => ({ month: v.label, count: v.count }));

    // Highest/average now reflect actual outcomes for placed students
    // (offered_package, falling back to the drive's advertised package),
    // not just what every drive advertised regardless of who got placed.
    const packages = Array.from(placedPackagesByStudent.values()).flat();
    const highestPackageLpa = packages.length ? Math.max(...packages) : 0;
    const averagePackageLpa = packages.length
      ? Math.round(
          (packages.reduce((sum, p) => sum + p, 0) / packages.length) * 10,
        ) / 10
      : 0;

    const upcomingDrives = activeDrives
      .filter((d) => d.scheduled_date >= today)
      .sort((a, b) => a.scheduled_date.getTime() - b.scheduled_date.getTime())
      .slice(0, 4)
      .map((d) => ({
        id: d.id,
        date: d.scheduled_date.toISOString().slice(0, 10),
        day: String(d.scheduled_date.getDate()).padStart(2, '0'),
        month: d.scheduled_date
          .toLocaleDateString('en-IN', { month: 'short' })
          .toUpperCase(),
        company: d.is_disclosed ? d.companies.name : 'Undisclosed',
        role: d.job_role ?? undefined,
      }));

    const placedStudentIds = new Set(placedPackagesByStudent.keys());
    const eligibleStudentsTotal = students.length;
    // Count against `students` (already batch-scoped above), not the raw
    // placedStudentIds set — that set is global, so using its size directly
    // would compare a batch-scoped denominator against a global numerator.
    const placedWithinScope = students.filter((s) =>
      placedStudentIds.has(s.id),
    ).length;
    const placementRate = eligibleStudentsTotal
      ? Math.round((placedWithinScope / eligibleStudentsTotal) * 1000) / 10
      : 0;

    const classMap = new Map<
      string,
      {
        students: number;
        placed: number;
        highestLpa: number;
        departmentName: string;
      }
    >();
    const deptMap = new Map<
      string,
      { students: number; placed: number; highestLpa: number }
    >();

    for (const s of students) {
      const classLabel = s.classes
        ? `${s.classes.departments.code} - ${s.classes.section}`
        : DrivesService.UNASSIGNED;
      const deptLabel = s.classes?.departments.name ?? DrivesService.UNASSIGNED;
      const isPlaced = placedStudentIds.has(s.id);
      const pkgs = placedPackagesByStudent.get(s.id) ?? [];
      const bestPackage = pkgs.length ? Math.max(...pkgs) : 0;

      const c = classMap.get(classLabel) ?? {
        students: 0,
        placed: 0,
        highestLpa: 0,
        departmentName: deptLabel,
      };
      c.students += 1;
      if (isPlaced) c.placed += 1;
      c.highestLpa = Math.max(c.highestLpa, bestPackage);
      classMap.set(classLabel, c);

      const d = deptMap.get(deptLabel) ?? {
        students: 0,
        placed: 0,
        highestLpa: 0,
      };
      d.students += 1;
      if (isPlaced) d.placed += 1;
      d.highestLpa = Math.max(d.highestLpa, bestPackage);
      deptMap.set(deptLabel, d);
    }

    const classWise = Array.from(classMap.entries()).map(([className, v]) => ({
      className,
      ...v,
    }));
    const departmentWise = Array.from(deptMap.entries()).map(
      ([department, v]) => ({ department, ...v }),
    );
    const placementRateByDepartment = departmentWise.map((d) => ({
      department: d.department,
      placed: d.placed,
      total: d.students,
    }));

    const now = new Date();
    const companiesAddedThisMonth = companies.filter(
      (c) =>
        c.created_at.getFullYear() === now.getFullYear() &&
        c.created_at.getMonth() === now.getMonth(),
    ).length;

    // Placement funnel — Eligible → Applied → Shortlisted → Interviewed →
    // Offers → Placed. Shortlisted/Interviewed use `last_cleared_round`
    // (set independently of a later rejection) rather than `status`, which
    // would undercount anyone rejected partway through the rounds.
    const appliedCount = applications.length;
    const shortlistedCount = applications.filter(
      (a) => (a.last_cleared_round ?? 0) >= 1,
    ).length;
    const interviewedCount = applications.filter(
      (a) => (a.last_cleared_round ?? 0) >= 2,
    ).length;
    const offersCount = applications.filter(
      (a) => a.status === 'placed' || a.offer_response != null,
    ).length;
    const acceptedOffersCount = applications.filter(
      (a) => a.offer_response === 'accepted',
    ).length;
    const funnel = {
      eligible: eligibleStudentsTotal,
      applied: appliedCount,
      shortlisted: shortlistedCount,
      interviewed: interviewedCount,
      offers: offersCount,
      placed: placedWithinScope,
    };

    // Package bands — accepted-offer packages bucketed into fixed ranges.
    const PACKAGE_BANDS = [
      { label: '0–6 LPA', min: 0, max: 6 },
      { label: '6–10 LPA', min: 6, max: 10 },
      { label: '10–20 LPA', min: 10, max: 20 },
      { label: '20 LPA+', min: 20, max: Infinity },
    ];
    const packageBands = PACKAGE_BANDS.map((band) => ({
      label: band.label,
      count: packages.filter((p) => p >= band.min && p < band.max).length,
    }));

    // Six-year trend — real placement rate per batch cohort (most recent 6
    // batches), independent of the optional `batchId` report filter above.
    const studentIdsByBatch = new Map<number, number[]>();
    for (const s of allStudentsForTrend) {
      const list = studentIdsByBatch.get(s.batch_id) ?? [];
      list.push(s.id);
      studentIdsByBatch.set(s.batch_id, list);
    }
    const sixYearTrend = batches
      .slice()
      .sort((a, b) => a.start_year - b.start_year)
      .map((b) => {
        const ids = studentIdsByBatch.get(b.id) ?? [];
        const placedInBatch = ids.filter((id) =>
          placedStudentIds.has(id),
        ).length;
        return {
          cycle: `${b.start_year}-${String(b.end_year).slice(-2)}`,
          rate: ids.length
            ? Math.round((placedInBatch / ids.length) * 1000) / 10
            : 0,
        };
      });

    // Top recruiters — companies with the most placed offers on record.
    const recruiterMap = new Map<
      string,
      { offers: number; packages: number[] }
    >();
    for (const [driveId, apps] of appsByDrive) {
      const drive = driveById.get(driveId);
      if (!drive) continue;
      const placedApps = apps.filter((a) => a.status === 'placed');
      if (placedApps.length === 0) continue;
      const name = drive.is_disclosed ? drive.companies.name : 'Undisclosed';
      const entry = recruiterMap.get(name) ?? { offers: 0, packages: [] };
      entry.offers += placedApps.length;
      const drivePackageLpa = drive.package_lpa
        ? Number(drive.package_lpa)
        : undefined;
      for (const p of placedApps) {
        const effectivePackage = p.offered_package
          ? Number(p.offered_package)
          : drivePackageLpa;
        if (effectivePackage !== undefined)
          entry.packages.push(effectivePackage);
      }
      recruiterMap.set(name, entry);
    }
    const topRecruiters = Array.from(recruiterMap.entries())
      .map(([company, v]) => ({
        company,
        offers: v.offers,
        avgPackageLpa: v.packages.length
          ? Math.round(
              (v.packages.reduce((sum, p) => sum + p, 0) / v.packages.length) *
                10,
            ) / 10
          : 0,
      }))
      .sort((a, b) => b.offers - a.offers)
      .slice(0, 6);

    // Needs attention — real, threshold-triggered flags computed from the
    // same data above, not a fixed illustrative list.
    const attentionFlags: {
      title: string;
      description: string;
      href: string;
    }[] = [];

    const pendingOffers = applications.filter(
      (a) => a.offer_response === 'pending',
    ).length;
    if (pendingOffers > 0) {
      attentionFlags.push({
        title: `${pendingOffers} offer${pendingOffers === 1 ? '' : 's'} awaiting a response`,
        description: 'Students yet to accept or decline',
        href: '/placement/offers',
      });
    }

    const unscreenedCount = appliedCount - shortlistedCount;
    if (unscreenedCount > 0) {
      attentionFlags.push({
        title: `${unscreenedCount} application${unscreenedCount === 1 ? '' : 's'} not yet screened`,
        description: 'Never progressed past the initial application',
        href: '/placement/rounds',
      });
    }

    const driveWithNoShortlist = activeDrives
      .filter((d) => {
        const apps = appsByDrive.get(d.id) ?? [];
        return (
          apps.length > 0 &&
          apps.every((a) => (a.last_cleared_round ?? 0) === 0)
        );
      })
      .sort(
        (a, b) => a.scheduled_date.getTime() - b.scheduled_date.getTime(),
      )[0];
    if (driveWithNoShortlist) {
      const name = driveWithNoShortlist.is_disclosed
        ? driveWithNoShortlist.companies.name
        : 'An undisclosed company';
      attentionFlags.push({
        title: `${name} drive has no shortlist yet`,
        description: `Drive scheduled ${driveWithNoShortlist.scheduled_date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`,
        href: `/placement/rounds?drive=${driveWithNoShortlist.id}`,
      });
    }

    const appliedStudentIds = new Set(applications.map((a) => a.student_id));
    const zeroApplicationCount = students.filter(
      (s) => !appliedStudentIds.has(s.id),
    ).length;
    if (zeroApplicationCount > 0) {
      attentionFlags.push({
        title: `${zeroApplicationCount} registered student${zeroApplicationCount === 1 ? '' : 's'} with zero applications`,
        description: 'Have not applied to any drive this cycle',
        href: '/placement/students',
      });
    }

    return {
      totalCompanies: companies.length,
      companiesAddedThisMonth,
      activeDriveCount: activeDrives.length,
      drivesClosingThisWeek,
      studentsInProcess,
      studentsInProcessDriveCount,
      studentsPlaced,
      acceptedOffersCount,
      highestPackageLpa,
      averagePackageLpa,
      offersByMonth,
      upcomingDrives,
      eligibleStudentsTotal,
      placementRate,
      classWise,
      departmentWise,
      placementRateByDepartment,
      funnel,
      packageBands,
      sixYearTrend,
      topRecruiters,
      attentionFlags,
    };
  }

  /**
   * Builds the exportable table for the Reports page's class-wise/
   * department-wise view — reuses getPlacementStats so the exported file
   * can never drift out of sync with what's shown on screen for the same
   * batch filter.
   */
  async buildReportTable(
    batchId: number | undefined,
    view: 'class' | 'department',
    department?: string,
  ): Promise<ReportTable> {
    const stats = await this.getPlacementStats(batchId);
    if (view === 'class' && department) {
      stats.classWise = stats.classWise.filter(
        (c) => c.departmentName === department,
      );
    }

    const batch = batchId
      ? await this.prisma.batches.findUnique({
          where: { id: batchId },
          select: { name: true },
        })
      : null;
    const subtitleParts = [batch ? `Batch ${batch.name}` : 'All batches'];
    if (view === 'class' && department) subtitleParts.push(department);
    const subtitle = subtitleParts.join(' · ');

    const columns =
      view === 'class'
        ? [
            { header: 'Class', key: 'label' },
            { header: 'Students', key: 'students', align: 'right' as const },
            { header: 'Placed', key: 'placed', align: 'right' as const },
            {
              header: 'Highest (LPA)',
              key: 'highestLpa',
              align: 'right' as const,
            },
          ]
        : [
            { header: 'Department', key: 'label' },
            { header: 'Students', key: 'students', align: 'right' as const },
            { header: 'Placed', key: 'placed', align: 'right' as const },
            {
              header: 'Highest (LPA)',
              key: 'highestLpa',
              align: 'right' as const,
            },
          ];

    const rows =
      view === 'class'
        ? stats.classWise.map((r) => ({
            label: r.className,
            students: r.students,
            placed: r.placed,
            highestLpa: r.highestLpa,
          }))
        : stats.departmentWise.map((r) => ({
            label: r.department,
            students: r.students,
            placed: r.placed,
            highestLpa: r.highestLpa,
          }));

    return {
      title:
        view === 'class'
          ? 'Class-wise Placement Report'
          : 'Department-wise Placement Report',
      subtitle,
      summary: [
        {
          label: 'Eligible students',
          value: String(stats.eligibleStudentsTotal),
        },
        { label: 'Placed', value: String(stats.studentsPlaced) },
        { label: 'Placement rate', value: `${stats.placementRate}%` },
        {
          label: 'Highest / Average',
          value: `₹${stats.highestPackageLpa} / ₹${stats.averagePackageLpa} LPA`,
        },
      ],
      columns,
      rows,
    };
  }

  /**
   * `audit_logs` has no natural entity for a report export (it's an action,
   * not a row mutation) — entity_id is a fixed 0 sentinel and the real
   * context (batch/view/format) lives in new_value instead. This is the
   * table's first writer; nothing else reads or writes it yet, so 0 can't
   * collide with an assumption some other caller already relies on.
   */
  async logReportExport(
    userId: number,
    action: 'export_class_report' | 'export_student_report',
    params: Record<string, unknown>,
  ) {
    await this.prisma.audit_logs.create({
      data: {
        entity_type: 'placement_report',
        entity_id: 0,
        action,
        performed_by_user_id: userId,
        new_value: params as Prisma.InputJsonValue,
      },
    });
  }

  async countReportExportsThisMonth(): Promise<number> {
    const now = new Date();
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    return this.prisma.audit_logs.count({
      where: {
        entity_type: 'placement_report',
        performed_at: { gte: startOfMonth },
      },
    });
  }

  /**
   * Every "placed" application across every drive, flattened for the Offers
   * page — one query instead of /drives + one /applications call per drive.
   */
  async getOffers() {
    const [applications, extras] = await Promise.all([
      this.prisma.student_drive_applications.findMany({
        where: { status: 'placed' },
        include: {
          students: {
            select: {
              id: true,
              student_id_no: true,
              roll_no: true,
              register_no: true,
              classes: {
                select: {
                  section: true,
                  departments: { select: { name: true, code: true } },
                },
              },
              soa_applications: {
                select: { first_name: true, last_name: true },
              },
            },
          },
          placement_drives: {
            select: {
              id: true,
              job_role: true,
              package_lpa: true,
              companies: { select: { name: true } },
            },
          },
        },
        orderBy: { updated_at: 'desc' },
      }),
      this.loadAllOfferExtras(),
    ]);

    return applications.map((a) => {
      const soa = a.students.soa_applications;
      const classes = a.students.classes;
      const rowExtras = extras.get(a.id) ?? NO_OFFER_EXTRAS;
      return {
        id: a.id,
        drive_id: a.drive_id,
        student_id: a.student_id,
        student_id_no: a.students.student_id_no,
        roll_no: a.students.roll_no,
        register_no: a.students.register_no,
        student_name: soa
          ? [soa.first_name, soa.last_name].filter(Boolean).join(' ')
          : null,
        department_name: classes?.departments.name ?? null,
        department_code: classes?.departments.code ?? null,
        class_label: classes
          ? `${classes.departments.code} - ${classes.section}`
          : null,
        company_name: a.placement_drives.companies.name,
        job_role: a.placement_drives.job_role,
        package_lpa: a.placement_drives.package_lpa,
        // DB column is `offered_package` — API field stays *_lpa for clarity.
        offered_package_lpa: a.offered_package,
        offer_response: a.offer_response,
        released_at: a.updated_at,
        joining_date: rowExtras.joining_date,
        work_location: rowExtras.work_location,
      };
    });
  }

  /**
   * `joining_date`/`work_location` are real once query.md #16 runs
   * (`student_drive_applications` gets the columns) — read via `$queryRaw`
   * since they predate a `prisma db pull`. Degrades to `NO_OFFER_EXTRAS`
   * when the columns don't exist yet.
   */
  private async loadAllOfferExtras(): Promise<Map<number, OfferExtras>> {
    try {
      const rows = await this.prisma.$queryRaw<
        ({ id: number } & OfferExtras)[]
      >`
        SELECT id, joining_date, work_location FROM student_drive_applications
      `;
      return new Map(rows.map((r) => [r.id, r]));
    } catch {
      return new Map();
    }
  }

  /**
   * `placement_eligible`/`placement_opted_out` are real once query.md #17
   * runs (`students` gets the columns) — read via `$queryRaw` since they
   * predate a `prisma db pull`. Degrades to `NO_PLACEMENT_FLAGS` (both
   * "not yet assessed") when the columns don't exist yet.
   */
  private async loadAllPlacementFlags(): Promise<Map<number, PlacementFlags>> {
    try {
      const rows = await this.prisma.$queryRaw<
        ({ id: number } & PlacementFlags)[]
      >`
        SELECT id, placement_eligible, placement_opted_out FROM students
      `;
      return new Map(rows.map((r) => [r.id, r]));
    } catch {
      return new Map();
    }
  }

  /**
   * PATCH /drives/students/:id/placement-status — Placement Officer
   * explicitly records eligibility/opt-out (neither is honestly computable
   * from existing data, see query.md #17). Throws a clear, typed error
   * instead of silently no-op'ing when the columns don't exist yet.
   */
  async updatePlacementStatus(
    studentId: number,
    dto: { placement_eligible?: boolean; placement_opted_out?: boolean },
  ) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException({
        message: `Student ${studentId} not found`,
        errorCode: 'NOT_FOUND',
      });
    }

    try {
      if (dto.placement_eligible !== undefined) {
        await this.prisma.$executeRaw`
          UPDATE students SET placement_eligible = ${dto.placement_eligible} WHERE id = ${studentId}
        `;
      }
      if (dto.placement_opted_out !== undefined) {
        await this.prisma.$executeRaw`
          UPDATE students SET placement_opted_out = ${dto.placement_opted_out} WHERE id = ${studentId}
        `;
      }
    } catch {
      throw new UnprocessableEntityException({
        message:
          'Placement eligibility/opt-out tracking is not enabled yet — see query.md #17.',
        errorCode: 'FEATURE_NOT_ENABLED',
      });
    }

    const flags = await this.loadAllPlacementFlags();
    return { id: studentId, ...(flags.get(studentId) ?? NO_PLACEMENT_FLAGS) };
  }

  /**
   * `students.career_path` — same column MeCareerPathService reads/writes
   * for a student's own self-view of "which path shows in my sidebar", but
   * here it's the Placement Officer setting it on someone else's record
   * (per the Students page's "Placement / Venture / Higher Studies" action —
   * staff-driven, not student self-service). Read via `$queryRaw` since the
   * column predates a `prisma db pull`, same as loadAllPlacementFlags above.
   */
  private async loadAllCareerPaths(): Promise<Map<number, CareerPath>> {
    try {
      const rows = await this.prisma.$queryRaw<
        { id: number; career_path: CareerPath | null }[]
      >`
        SELECT id, career_path FROM students WHERE career_path IS NOT NULL
      `;
      return new Map(
        rows
          .filter(
            (r): r is { id: number; career_path: CareerPath } =>
              r.career_path !== null,
          )
          .map((r) => [r.id, r.career_path]),
      );
    } catch {
      return new Map();
    }
  }

  /**
   * PATCH /drives/students/:id/career-path — Placement Officer marks a
   * student as pursuing Placement, or (their way of recording "not
   * interested in placement") Venture or Higher Studies. Drives which one
   * of those three tabs shows in that student's own sidebar (see
   * MeCareerPathService.getMyCareerPath, read-only from the student side).
   */
  async setStudentCareerPath(studentId: number, careerPath: CareerPath) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException({
        message: `Student ${studentId} not found`,
        errorCode: 'NOT_FOUND',
      });
    }

    try {
      await this.prisma.$executeRaw`
        UPDATE students SET career_path = ${careerPath} WHERE id = ${studentId}
      `;
    } catch (err) {
      this.logger.error(
        `Failed to set career_path for student ${studentId}`,
        err,
      );
      throw new UnprocessableEntityException({
        message: 'This feature is not enabled yet.',
        errorCode: 'FEATURE_NOT_ENABLED',
      });
    }

    return { id: studentId, career_path: careerPath };
  }

  // ───────────────────────────── Student-facing history ─────────────────────────────
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
    const applications = await this.prisma.student_drive_applications.findMany({
      where: {
        student_id: studentId,
        status: { notIn: [...DrivesService.CONCLUDED_APPLICATION_STATUSES] },
      },
      include: { placement_drives: { include: { companies: true } } },
      orderBy: { placement_drives: { scheduled_date: 'asc' } },
    });

    return applications.map((app) => this.toUpcomingDrive(app));
  }

  /**
   * GET /drives/student/posted — every currently-open, currently-in-window
   * drive the placement cell has posted that this student is eligible for
   * and has NOT been shortlisted/applied for yet (no
   * student_drive_applications row). Applying (see applyToDrive below)
   * creates that row itself, so a drive naturally moves from this list to
   * "upcoming" the moment a student applies.
   *
   * Eligibility here is deliberately limited to what's honestly real today:
   *  - registration_start/registration_end are real columns, enforced below.
   *  - eligible_department_codes is read via loadAllDriveExtras() the same
   *    way every other consumer of it does — it degrades to "no restriction"
   *    (every department passes) until query.md #14 actually adds the
   *    column, then activates automatically with no further code change.
   *  - eligibility_cgpa is a real column but there is no live, computed CGPA
   *    for a currently-enrolled student anywhere in this schema to check it
   *    against — it is surfaced on each drive for information only, never
   *    used to filter this list.
   */
  async getPostedForStudent(user: JwtPayload) {
    const student = await this.findStudentOrThrow(user.sub);
    return this.getPostedForStudentId(student.id);
  }

  private async getPostedForStudentId(studentId: number) {
    const [shortlisted, student] = await Promise.all([
      this.prisma.student_drive_applications.findMany({
        where: { student_id: studentId },
        select: { drive_id: true },
      }),
      this.prisma.students.findUnique({
        where: { id: studentId },
        select: {
          classes: { select: { departments: { select: { code: true } } } },
        },
      }),
    ]);
    const myDepartmentCode =
      student?.classes?.departments.code?.toUpperCase() ?? null;
    const now = today();

    const drives = await this.prisma.placement_drives.findMany({
      where: {
        status: 'scheduled',
        scheduled_date: { gte: now },
        id: { notIn: shortlisted.map((s) => s.drive_id) },
        AND: [
          {
            OR: [
              { registration_start: null },
              { registration_start: { lte: now } },
            ],
          },
          {
            OR: [
              { registration_end: null },
              { registration_end: { gte: now } },
            ],
          },
        ],
      },
      include: { companies: true },
      orderBy: { scheduled_date: 'asc' },
    });
    if (drives.length === 0) return [];

    const extrasById = await this.loadAllDriveExtras();
    const eligibleDrives = drives.filter((drive) => {
      const codes = extrasById.get(drive.id)?.eligible_department_codes;
      if (!codes) return true;
      const allowed = codes.split(',').map((c) => c.trim().toUpperCase());
      return myDepartmentCode !== null && allowed.includes(myDepartmentCode);
    });

    return eligibleDrives.map((drive) => ({
      drive_id: drive.id,
      company_name: this.resolveCompanyName(drive),
      company_profile_info: drive.is_disclosed
        ? drive.companies.profile_info
        : null,
      scheduled_date: drive.scheduled_date,
      is_disclosed: drive.is_disclosed,
      disclosed_reveal_date: drive.is_disclosed
        ? null
        : drive.disclosed_reveal_date,
      job_role: drive.job_role,
      package_lpa:
        drive.package_lpa === null ? null : Number(drive.package_lpa),
      eligibility_cgpa:
        drive.eligibility_cgpa === null ? null : Number(drive.eligibility_cgpa),
      registration_start: drive.registration_start,
      registration_end: drive.registration_end,
    }));
  }

  /**
   * POST /drives/student/:id/apply — self-service application. Idempotent:
   * an application that already exists (whether created by this same
   * endpoint or by the placement cell shortlisting the student directly)
   * is returned as-is rather than raising a conflict.
   *
   * Re-checks the same registration-window and department-eligibility rules
   * getPostedForStudentId already filters the list by, as defense in depth
   * against a stale/forged drive id, plus a resume-completeness gate that
   * list doesn't need. Error cases:
   *  404 STUDENT_NOT_FOUND     – caller has no linked student record
   *  404 (drive not found)     – via findOrThrow
   *  422 DRIVE_NOT_OPEN        – drive status isn't 'scheduled'
   *  422 REGISTRATION_NOT_OPEN / REGISTRATION_CLOSED
   *  403 NOT_ELIGIBLE          – student's department isn't in eligible_department_codes
   *  422 RESUME_INCOMPLETE     – no resume link on the student's placement profile
   */
  async applyToDrive(user: JwtPayload, driveId: number) {
    const student = await this.findStudentOrThrow(user.sub);
    return this.applyToDriveForStudentId(student.id, driveId);
  }

  private async applyToDriveForStudentId(studentId: number, driveId: number) {
    const existing = await this.prisma.student_drive_applications.findUnique({
      where: {
        drive_id_student_id: { drive_id: driveId, student_id: studentId },
      },
    });
    if (existing) return existing;

    const drive = await this.findOrThrow(driveId);

    if (drive.status !== 'scheduled') {
      throw new UnprocessableEntityException({
        message: 'This drive is no longer accepting applications',
        errorCode: 'DRIVE_NOT_OPEN',
      });
    }

    const now = today();
    if (drive.registration_start && now < drive.registration_start) {
      throw new UnprocessableEntityException({
        message: 'Registration for this drive has not opened yet',
        errorCode: 'REGISTRATION_NOT_OPEN',
      });
    }
    if (drive.registration_end && now > drive.registration_end) {
      throw new UnprocessableEntityException({
        message: 'Registration for this drive has closed',
        errorCode: 'REGISTRATION_CLOSED',
      });
    }

    const extras = await this.loadDriveExtras(driveId);
    if (extras.eligible_department_codes) {
      const student = await this.prisma.students.findUnique({
        where: { id: studentId },
        select: {
          classes: { select: { departments: { select: { code: true } } } },
        },
      });
      const allowed = extras.eligible_department_codes
        .split(',')
        .map((c) => c.trim().toUpperCase());
      const myCode = student?.classes?.departments.code?.toUpperCase();
      if (!myCode || !allowed.includes(myCode)) {
        throw new ForbiddenException({
          message: 'You are not eligible for this drive',
          errorCode: 'NOT_ELIGIBLE',
        });
      }
    }

    const profile = await this.prisma.student_profiles.findUnique({
      where: { student_id: studentId },
      select: { resume_url: true },
    });
    if (!profile?.resume_url) {
      throw new UnprocessableEntityException({
        message: 'Add a resume link to your placement profile before applying',
        errorCode: 'RESUME_INCOMPLETE',
      });
    }

    return this.prisma.student_drive_applications.create({
      data: { drive_id: driveId, student_id: studentId },
    });
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
    const applications = await this.prisma.student_drive_applications.findMany({
      where: {
        student_id: studentId,
        status: { in: [...DrivesService.CONCLUDED_APPLICATION_STATUSES] },
      },
      include: { placement_drives: { include: { companies: true } } },
      orderBy: { updated_at: 'desc' },
    });

    return applications.map((app) => {
      const drive = app.placement_drives;
      return {
        drive_id: drive.id,
        company_name: this.resolveCompanyName(drive),
        scheduled_date: drive.scheduled_date,
        drive_status: drive.status,
        job_role: drive.job_role,
        package_lpa:
          drive.package_lpa === null ? null : Number(drive.package_lpa),
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
      include: {
        companies: true,
        // Real registered-applicant count — the same _count pattern
        // DrivesService.findAll already uses for the admin listing, added
        // here too instead of leaving "— registered" on the faculty view.
        _count: { select: { student_drive_applications: true } },
      },
      orderBy: { scheduled_date: 'asc' },
    });

    return drives.map((drive) => ({
      drive_id: drive.id,
      company_name: this.resolveCompanyName(drive),
      company_profile_info: drive.is_disclosed
        ? drive.companies.profile_info
        : null,
      scheduled_date: drive.scheduled_date,
      is_disclosed: drive.is_disclosed,
      disclosed_reveal_date: drive.is_disclosed
        ? null
        : drive.disclosed_reveal_date,
      // Real columns on placement_drives, previously fetched but dropped
      // when shaping this response.
      job_role: drive.job_role,
      venue: drive.venue,
      status: drive.status,
      eligibility_cgpa:
        drive.eligibility_cgpa === null ? null : Number(drive.eligibility_cgpa),
      registered_count: drive._count.student_drive_applications,
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
   * GET /me/upcoming-drives/:driveId/applications (Faculty only) — real
   * per-mentee application status/round for a specific drive, via
   * student_drive_applications (unique on drive_id+student_id). Previously
   * the "View student list" expander under each drive had no data source
   * at all for this; the real columns (status, last_cleared_round) exist
   * per application — there is no institution-wide named-round schema
   * (no "Aptitude test"/"Technical round 1" labels anywhere in schema.prisma),
   * only a plain numeric last_cleared_round, so this returns that real
   * number rather than an invented round name.
   */
  async getDriveApplicationsForMentor(driveId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mentorClasses = await this.prisma.class_mentors.findMany({
      where: { faculty_id: faculty.id },
      select: { class_id: true },
    });
    const classIds = mentorClasses.map((m) => m.class_id);
    if (classIds.length === 0) return [];

    const applications = await this.prisma.student_drive_applications.findMany({
      where: { drive_id: driveId, students: { class_id: { in: classIds } } },
      select: {
        status: true,
        last_cleared_round: true,
        offer_response: true,
        offered_package: true,
        students: {
          select: {
            id: true,
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
          },
        },
      },
      orderBy: { students: { student_id_no: 'asc' } },
    });

    return applications.map((app) => ({
      student_id: app.students.id,
      student_id_no: app.students.student_id_no,
      name: this.resolveStudentDisplayName(app.students),
      status: app.status,
      last_cleared_round: app.last_cleared_round,
      offer_response: app.offer_response,
      offered_package:
        app.offered_package === null ? null : Number(app.offered_package),
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

    const applications = await this.prisma.student_drive_applications.findMany({
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
    });

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

    const applications = await this.prisma.student_drive_applications.findMany({
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
    });

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
    if (
      !student.classes ||
      student.classes.department_id !== hod.department_id
    ) {
      throw new ForbiddenException('This student is not in your department');
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
      company_profile_info: drive.is_disclosed
        ? drive.companies.profile_info
        : null,
      scheduled_date: drive.scheduled_date,
      is_disclosed: drive.is_disclosed,
      disclosed_reveal_date: drive.is_disclosed
        ? null
        : drive.disclosed_reveal_date,
      job_role: drive.job_role,
      package_lpa:
        drive.package_lpa === null ? null : Number(drive.package_lpa),
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

  /**
   * GET /drives/students/:studentId/history (Admin/Placement).
   * Same query as the student-self-service history above, keyed by an
   * explicit student id instead of the caller's own JWT.
   */
  async getHistoryForStudentId(studentId: number) {
    const applications = await this.prisma.student_drive_applications.findMany({
      where: { student_id: studentId },
      include: { placement_drives: { include: { companies: true } } },
      orderBy: { updated_at: 'desc' },
    });

    return applications.map((app) => {
      const drive = app.placement_drives;
      return {
        drive_id: drive.id,
        company_name: drive.is_disclosed ? drive.companies.name : 'Undisclosed',
        scheduled_date: drive.scheduled_date,
        drive_status: drive.status,
        application_status: app.status,
      };
    });
  }

  /**
   * Full profile for one student — powers the Placement Drives student
   * detail page (reachable from a drive's Student list). CGPA/backlogs
   * stay off this shape entirely (no such column anywhere in the schema);
   * `resume_url` is real, from `student_profiles`.
   */
  async getStudentProfile(studentId: number) {
    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
      select: {
        id: true,
        student_id_no: true,
        register_no: true,
        photo_url: true,
        classes: {
          select: {
            current_semester: true,
            departments: { select: { name: true, code: true } },
          },
        },
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
        student_profiles: {
          select: {
            resume_url: true,
            linkedin_url: true,
            github_url: true,
            leetcode_url: true,
            hackerrank_url: true,
            codeforces_url: true,
          },
        },
      },
    });
    if (!student) throw new NotFoundException(`Student ${studentId} not found`);

    const applications = await this.prisma.student_drive_applications.findMany({
      where: { student_id: studentId },
      include: { placement_drives: { include: { companies: true } } },
      orderBy: { updated_at: 'desc' },
    });

    const progressRank = (a: (typeof applications)[number]) =>
      a.status === 'placed' ? 100 : (a.last_cleared_round ?? 0);
    const best = applications.length
      ? applications.reduce((a, b) =>
          progressRank(b) > progressRank(a) ? b : a,
        )
      : null;
    const offersCount = applications.filter(
      (a) => a.status === 'placed' || a.offer_response != null,
    ).length;

    const soa = student.soa_applications;
    const companyLabel = (
      drive: (typeof applications)[number]['placement_drives'],
    ) => (drive.is_disclosed ? drive.companies.name : 'Undisclosed');

    return {
      id: student.id,
      student_id_no: student.student_id_no,
      register_no: student.register_no,
      name:
        soa?.first_name || soa?.last_name
          ? [soa?.first_name, soa?.last_name].filter(Boolean).join(' ')
          : student.users.email,
      email: student.users.email,
      department_name: student.classes?.departments.name ?? null,
      department_code: student.classes?.departments.code ?? null,
      year:
        student.classes?.current_semester != null
          ? Math.ceil(student.classes.current_semester / 2)
          : null,
      photo_url: student.photo_url,
      resume_url: student.student_profiles?.resume_url ?? null,
      linkedin_url: student.student_profiles?.linkedin_url ?? null,
      github_url: student.student_profiles?.github_url ?? null,
      leetcode_url: student.student_profiles?.leetcode_url ?? null,
      hackerrank_url: student.student_profiles?.hackerrank_url ?? null,
      codeforces_url: student.student_profiles?.codeforces_url ?? null,
      drives_applied: applications.length,
      offers_count: offersCount,
      status: best?.status ?? null,
      applications: applications.map((a) => ({
        drive_id: a.drive_id,
        company_name: companyLabel(a.placement_drives),
        job_role: a.placement_drives.job_role,
        status: a.status,
        updated_at: a.updated_at,
      })),
      offers: applications
        .filter((a) => a.status === 'placed' || a.offer_response != null)
        .map((a) => ({
          drive_id: a.drive_id,
          company_name: companyLabel(a.placement_drives),
          job_role: a.placement_drives.job_role,
          offered_package:
            a.offered_package != null
              ? Number(a.offered_package)
              : a.placement_drives.package_lpa != null
                ? Number(a.placement_drives.package_lpa)
                : null,
          offer_response: a.offer_response,
          updated_at: a.updated_at,
        })),
    };
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

  /**
   * `mode`/`backlogs_allowed`/`eligible_department_codes`/`round1_label`/
   * `round2_label`/`round3_label`/`result_declaration_note` are real once
   * query.md #14 runs (`placement_drives` gets the columns) — read/written
   * via `$queryRaw` rather than the typed client since they predate a
   * `prisma db pull`. Every read here degrades to `NO_DRIVE_EXTRAS`, and
   * every write silently no-ops, when the columns don't exist yet.
   */
  private async loadDriveExtras(id: number): Promise<DriveExtras> {
    try {
      const rows = await this.prisma.$queryRaw<DriveExtras[]>`
        SELECT mode, backlogs_allowed, eligible_department_codes, round1_label, round2_label, round3_label, result_declaration_note
        FROM placement_drives WHERE id = ${id}
      `;
      return rows[0] ?? NO_DRIVE_EXTRAS;
    } catch {
      return NO_DRIVE_EXTRAS;
    }
  }

  private async loadAllDriveExtras(): Promise<Map<number, DriveExtras>> {
    try {
      const rows = await this.prisma.$queryRaw<
        ({ id: number } & DriveExtras)[]
      >`
        SELECT id, mode, backlogs_allowed, eligible_department_codes, round1_label, round2_label, round3_label, result_declaration_note
        FROM placement_drives
      `;
      return new Map(rows.map((r) => [r.id, r]));
    } catch {
      return new Map();
    }
  }

  private async writeDriveExtras(
    id: number,
    dto: Partial<DriveExtras>,
  ): Promise<void> {
    const hasAny = Object.values(dto).some((v) => v !== undefined);
    if (!hasAny) return;

    try {
      await this.prisma.$executeRaw`
        UPDATE placement_drives SET
          mode = COALESCE(${dto.mode ?? null}, mode),
          backlogs_allowed = COALESCE(${dto.backlogs_allowed ?? null}, backlogs_allowed),
          eligible_department_codes = COALESCE(${dto.eligible_department_codes ?? null}, eligible_department_codes),
          round1_label = COALESCE(${dto.round1_label ?? null}, round1_label),
          round2_label = COALESCE(${dto.round2_label ?? null}, round2_label),
          round3_label = COALESCE(${dto.round3_label ?? null}, round3_label),
          result_declaration_note = COALESCE(${dto.result_declaration_note ?? null}, result_declaration_note)
        WHERE id = ${id}
      `;
    } catch {
      // columns don't exist yet — query.md #14 not run; silently degrade.
    }
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
