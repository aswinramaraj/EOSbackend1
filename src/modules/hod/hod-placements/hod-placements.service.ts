import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

function studentName(
  soa: { first_name: string; last_name: string | null } | null,
): string | null {
  if (!soa) return null;
  return (
    [soa.first_name, soa.last_name].filter(Boolean).join(' ').trim() || null
  );
}

@Injectable()
export class HodPlacementsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves the caller's own faculty row + department — never trusts a client-supplied department_id. */
  async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    const department = await this.prisma.departments.findUnique({
      where: { id: faculty.department_id },
      select: { id: true, name: true, code: true },
    });
    if (!department) {
      throw new NotFoundException('Department not found');
    }
    return { faculty, department };
  }

  /**
   * "Eligible for placement" = the same final-year signal used by
   * hod-dashboard's own placements summary: a student in the last two
   * semesters of their course's duration — there is no explicit
   * is_final_year flag anywhere in the schema.
   */
  private isFinalYear(
    semester: number | null,
    durationYears: number | null,
  ): boolean {
    if (semester == null || durationYears == null) return false;
    return semester >= durationYears * 2 - 1;
  }

  /**
   * Every class in the department beyond first-year — matches the reference
   * design's own "All classes · II, III & IV year" filter label. First-year
   * students are excluded from placement tracking entirely (semester 1-2),
   * since they're structurally ineligible for any drive; there's no
   * separate is_eligible_for_placement flag anywhere in the schema to read
   * this from directly.
   */
  private async getEligibleClasses(departmentId: number) {
    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId, current_semester: { gt: 2 } },
      select: { id: true, section: true, current_semester: true },
      orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
    });
    return classes.map((c) => ({
      class_id: c.id,
      section: c.section,
      semester: c.current_semester,
      year_label: yearLabelForSemester(c.current_semester as number),
      class_label: `${yearLabelForSemester(c.current_semester as number)}-${c.section}`,
    }));
  }

  /** GET /hod/placements/students?search=&class_id= */
  async getStudentRecords(userId: number, search?: string, classId?: number) {
    const { department } = await this.resolveHodDepartment(userId);
    const eligibleClasses = await this.getEligibleClasses(department.id);
    const eligibleClassIds = eligibleClasses.map((c) => c.class_id);

    const scopedClassIds =
      classId != null && eligibleClassIds.includes(classId)
        ? [classId]
        : eligibleClassIds;

    // The search box's own placeholder promises company matches too — a
    // student's company only exists via their drive application, so that
    // needs its own lookup first rather than a direct field on `students`.
    const companyMatchedStudentIds = search
      ? (
          await this.prisma.student_drive_applications.findMany({
            where: {
              placement_drives: {
                companies: { name: { contains: search, mode: 'insensitive' } },
              },
            },
            select: { student_id: true },
          })
        ).map((a) => a.student_id)
      : [];

    const students = scopedClassIds.length
      ? await this.prisma.students.findMany({
          where: {
            class_id: { in: scopedClassIds },
            status: 'active',
            OR: search
              ? [
                  { student_id_no: { contains: search, mode: 'insensitive' } },
                  {
                    soa_applications: {
                      OR: [
                        {
                          first_name: { contains: search, mode: 'insensitive' },
                        },
                        {
                          last_name: { contains: search, mode: 'insensitive' },
                        },
                      ],
                    },
                  },
                  ...(companyMatchedStudentIds.length
                    ? [{ id: { in: companyMatchedStudentIds } }]
                    : []),
                ]
              : undefined,
          },
          select: {
            id: true,
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
            classes: { select: { section: true, current_semester: true } },
          },
          orderBy: { student_id_no: 'asc' },
        })
      : [];

    const applications = await this.prisma.student_drive_applications.findMany({
      where: { student_id: { in: students.map((s) => s.id) } },
      select: {
        student_id: true,
        status: true,
        offered_package: true,
        placement_drives: { select: { companies: { select: { name: true } } } },
      },
      orderBy: { updated_at: 'desc' },
    });

    const byStudent = new Map<number, typeof applications>();
    for (const app of applications) {
      const list = byStudent.get(app.student_id) ?? [];
      list.push(app);
      byStudent.set(app.student_id, list);
    }

    let placedCount = 0;
    let inProcessCount = 0;
    let unplacedCount = 0;

    const rows = students.map((s) => {
      const apps = byStudent.get(s.id) ?? [];
      const placedApps = apps.filter((a) => a.status === 'placed');
      const inProcessApps = apps.filter(
        (a) => a.status !== 'placed' && a.status !== 'rejected',
      );

      let status: 'placed' | 'in_process' | 'unplaced';
      let bestApp: (typeof apps)[number] | undefined;
      if (placedApps.length > 0) {
        status = 'placed';
        bestApp = placedApps.reduce((best, a) =>
          Number(a.offered_package ?? 0) > Number(best.offered_package ?? 0)
            ? a
            : best,
        );
        placedCount += 1;
      } else if (inProcessApps.length > 0) {
        status = 'in_process';
        bestApp = inProcessApps[0];
        inProcessCount += 1;
      } else {
        status = 'unplaced';
        unplacedCount += 1;
      }

      return {
        student_id: s.id,
        student_id_no: s.student_id_no,
        // Falls back to email rather than leaving an empty bold name line —
        // same gap/fallback as everywhere else this pattern shows up
        // (soa_applications isn't populated for every student).
        name: studentName(s.soa_applications) ?? s.users.email,
        class_label:
          s.classes?.current_semester != null
            ? `${yearLabelForSemester(s.classes.current_semester)}-${s.classes.section}`
            : (s.classes?.section ?? null),
        company: bestApp?.placement_drives.companies.name ?? null,
        package_lpa:
          bestApp?.offered_package != null
            ? Number(bestApp.offered_package)
            : null,
        offers: placedApps.length,
        status,
      };
    });

    return {
      department,
      classes: eligibleClasses,
      selected_class_id:
        classId != null && eligibleClassIds.includes(classId) ? classId : null,
      counts: {
        placed: placedCount,
        in_process: inProcessCount,
        unplaced: unplacedCount,
      },
      rows,
    };
  }

  /** GET /hod/placements/drives — campus-wide (placement_drives carries no department/class link). */
  async getUpcomingDrives() {
    const today = new Date(new Date().toISOString().slice(0, 10));
    const drives = await this.prisma.placement_drives.findMany({
      where: { scheduled_date: { gte: today } },
      orderBy: { scheduled_date: 'asc' },
      select: {
        id: true,
        job_role: true,
        package_lpa: true,
        eligibility_cgpa: true,
        scheduled_date: true,
        registration_start: true,
        registration_end: true,
        status: true,
        companies: { select: { name: true } },
      },
    });
    return drives.map((d) => ({
      id: d.id,
      company_name: d.companies.name,
      job_role: d.job_role,
      package_lpa: d.package_lpa != null ? Number(d.package_lpa) : null,
      eligibility_cgpa:
        d.eligibility_cgpa != null ? Number(d.eligibility_cgpa) : null,
      scheduled_date: d.scheduled_date.toISOString().slice(0, 10),
      registration_start:
        d.registration_start?.toISOString().slice(0, 10) ?? null,
      registration_end: d.registration_end?.toISOString().slice(0, 10) ?? null,
      status: d.status,
    }));
  }

  /** GET /hod/placements/history — this department's own placement outcomes, one row per batch. */
  async getHistory(userId: number) {
    const { department } = await this.resolveHodDepartment(userId);

    const classes = await this.prisma.classes.findMany({
      where: { department_id: department.id },
      select: {
        batch_id: true,
        id: true,
        courses: { select: { duration_years: true } },
        batches: { select: { name: true, start_year: true, end_year: true } },
      },
    });

    const batchGroups = new Map<number, typeof classes>();
    for (const c of classes) {
      const list = batchGroups.get(c.batch_id) ?? [];
      list.push(c);
      batchGroups.set(c.batch_id, list);
    }

    const rows = await Promise.all(
      [...batchGroups.entries()].map(async ([batchId, classesInBatch]) => {
        const classIds = classesInBatch.map((c) => c.id);
        const students = await this.prisma.students.findMany({
          where: { class_id: { in: classIds }, status: 'active' },
          select: {
            id: true,
            classes: {
              select: {
                current_semester: true,
                courses: { select: { duration_years: true } },
              },
            },
          },
        });
        const eligibleIds = students
          .filter((s) =>
            this.isFinalYear(
              s.classes?.current_semester ?? null,
              s.classes?.courses.duration_years ?? null,
            ),
          )
          .map((s) => s.id);

        if (eligibleIds.length === 0) return null;

        const placedApps =
          await this.prisma.student_drive_applications.findMany({
            where: { student_id: { in: eligibleIds }, status: 'placed' },
            select: {
              student_id: true,
              offered_package: true,
              placement_drives: {
                select: { companies: { select: { name: true } } },
              },
            },
            distinct: ['student_id'],
          });

        const packages = placedApps
          .map((p) =>
            p.offered_package != null ? Number(p.offered_package) : null,
          )
          .filter((p): p is number => p != null);

        const recruiterCounts = new Map<string, number>();
        for (const p of placedApps) {
          const name = p.placement_drives.companies.name;
          recruiterCounts.set(name, (recruiterCounts.get(name) ?? 0) + 1);
        }
        const topRecruiter =
          [...recruiterCounts.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

        const batch = classesInBatch[0].batches;
        return {
          batch_id: batchId,
          batch_label: `${batch.start_year}-${batch.end_year}`,
          eligible_count: eligibleIds.length,
          placed_count: placedApps.length,
          placement_percent:
            Math.round((placedApps.length / eligibleIds.length) * 1000) / 10,
          average_package_lpa: packages.length
            ? Math.round(
                (packages.reduce((a, b) => a + b, 0) / packages.length) * 100,
              ) / 100
            : null,
          top_recruiter: topRecruiter
            ? { name: topRecruiter[0], offers: topRecruiter[1] }
            : null,
        };
      }),
    );

    return {
      department,
      rows: rows
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.batch_id - a.batch_id),
    };
  }
}
