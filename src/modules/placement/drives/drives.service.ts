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
import type { ReportTable } from './report-export.util';

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

    return this.prisma.student_drive_applications.update({
      where: { id: application.id },
      data: {
        status: dto.status,
        ...(roundReached !== undefined
          ? { last_cleared_round: roundReached }
          : {}),
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
    const [students, applications] = await Promise.all([
      this.prisma.students.findMany({
        where: batchId ? { batch_id: batchId } : undefined,
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
          soa_applications: { select: { first_name: true, last_name: true } },
        },
        orderBy: { student_id_no: 'asc' },
      }),
      this.prisma.student_drive_applications.findMany({
        select: {
          student_id: true,
          status: true,
          last_cleared_round: true,
          updated_at: true,
          placement_drives: {
            select: { companies: { select: { name: true } } },
          },
        },
      }),
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

      return {
        id: s.id,
        student_id_no: s.student_id_no,
        roll_no: s.roll_no,
        name: soa
          ? [soa.first_name, soa.last_name].filter(Boolean).join(' ')
          : null,
        class_label: s.classes
          ? `${s.classes.departments.code} - ${s.classes.section}`
          : null,
        department_name: s.classes?.departments.name ?? null,
        drives_applied: apps.length,
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

    const [companies, drives, applications, students] = await Promise.all([
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

    return {
      totalCompanies: companies.length,
      companiesAddedThisMonth,
      activeDriveCount: activeDrives.length,
      drivesClosingThisWeek,
      studentsInProcess,
      studentsInProcessDriveCount,
      studentsPlaced,
      highestPackageLpa,
      averagePackageLpa,
      offersByMonth,
      upcomingDrives,
      eligibleStudentsTotal,
      placementRate,
      classWise,
      departmentWise,
      placementRateByDepartment,
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
   * Every "placed" application across every drive, flattened for the Offers
   * page — one query instead of /drives + one /applications call per drive.
   */
  async getOffers() {
    const applications = await this.prisma.student_drive_applications.findMany({
      where: { status: 'placed' },
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
    });

    return applications.map((a) => {
      const soa = a.students.soa_applications;
      const classes = a.students.classes;
      return {
        id: a.id,
        drive_id: a.drive_id,
        student_id: a.student_id,
        student_id_no: a.students.student_id_no,
        roll_no: a.students.roll_no,
        student_name: soa
          ? [soa.first_name, soa.last_name].filter(Boolean).join(' ')
          : null,
        department_name: classes?.departments.name ?? null,
        class_label: classes
          ? `${classes.departments.code} - ${classes.section}`
          : null,
        company_name: a.placement_drives.companies.name,
        job_role: a.placement_drives.job_role,
        package_lpa: a.placement_drives.package_lpa,
        // DB column is `offered_package` — API field stays *_lpa for clarity.
        offered_package_lpa: a.offered_package,
        offer_response: a.offer_response,
      };
    });
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

    const applications = await this.prisma.student_drive_applications.findMany({
      where: {
        student_id: student.id,
        status: { notIn: [...DrivesService.CONCLUDED_APPLICATION_STATUSES] },
      },
      include: { placement_drives: { include: { companies: true } } },
      orderBy: { placement_drives: { scheduled_date: 'asc' } },
    });

    return applications.map((app) => this.toUpcomingDrive(app));
  }

  /** GET /drives/student/history — drives where this student has a final outcome (placed/rejected). */
  async getHistoryForStudent(user: JwtPayload) {
    const student = await this.findStudentOrThrow(user.sub);
    return this.buildHistoryForStudentId(student.id);
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
        application_status: app.status,
        last_cleared_round: app.last_cleared_round,
      };
    });
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
      company_profile_info: drive.is_disclosed
        ? drive.companies.profile_info
        : null,
      scheduled_date: drive.scheduled_date,
      is_disclosed: drive.is_disclosed,
      disclosed_reveal_date: drive.is_disclosed
        ? null
        : drive.disclosed_reveal_date,
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
    placement_drives: {
      id: number;
      scheduled_date: Date;
      is_disclosed: boolean;
      disclosed_reveal_date: Date | null;
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
      application_status: app.status,
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
