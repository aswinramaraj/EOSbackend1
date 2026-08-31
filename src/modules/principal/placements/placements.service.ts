import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

function toDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const HOD_SELECT = {
  id: true,
  first_name: true,
  last_name: true,
  designation: true,
} as const;

function hodDto(
  row: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
  } | null,
) {
  if (!row) return null;
  return {
    faculty_id: row.id,
    name: `${row.first_name} ${row.last_name}`,
    designation: row.designation,
  };
}

interface DepartmentPlacement {
  department: { id: number; name: string; code: string };
  eligible: number;
  placed: number;
  unplaced: number;
  placement_rate: number | null;
  average_package: number | null;
  highest_package: number | null;
}

/**
 * `placement_drives`/`student_drive_applications` have no season/academic-
 * year field anywhere (confirmed: grepped for placement_season/
 * placement_batch, zero matches) — "Placement season 2026" from the
 * reference design is not a real, bounded entity in this schema, so every
 * figure here is computed over ALL drives/applications on file rather than
 * one fabricated year window. Same reasoning applies to "vs last year" and
 * a placement "target" percentage — no historical-year boundary or target
 * value exists anywhere to compute or read, so neither is shown.
 *
 * "Eligible" is not CGPA-filtered anywhere in this codebase's real
 * business logic (`eligibility_cgpa` on placement_drives is a
 * display-only field the placement officer sets, never enforced) — it
 * means "every active student in scope", matching
 * PlacementDrivesService.getPlacementStats()'s own convention.
 */
@Injectable()
export class PrincipalPlacementsService {
  constructor(private readonly prisma: PrismaService) {}

  private async loadApplications() {
    return this.prisma.student_drive_applications.findMany({
      select: {
        student_id: true,
        status: true,
        offered_package: true,
        offer_response: true,
        updated_at: true,
        students: {
          select: {
            id: true,
            class_id: true,
            student_id_no: true,
            register_no: true,
            classes: {
              select: {
                department_id: true,
                current_semester: true,
                departments: { select: { code: true } },
              },
            },
            courses: {
              select: {
                department_id: true,
                departments: { select: { code: true } },
              },
            },
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
          },
        },
        placement_drives: {
          select: {
            id: true,
            package_lpa: true,
            job_role: true,
            companies: { select: { id: true, name: true } },
          },
        },
      },
    });
  }

  private studentName(s: {
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
  }): string {
    if (!s.soa_applications) return s.users.email;
    return [s.soa_applications.first_name, s.soa_applications.last_name]
      .filter(Boolean)
      .join(' ');
  }

  private packageFor(
    app: Awaited<ReturnType<typeof this.loadApplications>>[number],
  ): number | null {
    const value =
      app.offered_package != null
        ? Number(app.offered_package)
        : app.placement_drives.package_lpa != null
          ? Number(app.placement_drives.package_lpa)
          : null;
    return value != null && value > 0 ? value : null;
  }

  /**
   * GET /me/principal/placements/summary
   */
  async summary() {
    const [applications, drives, eligibleCount] = await Promise.all([
      this.loadApplications(),
      this.prisma.placement_drives.findMany({
        select: {
          id: true,
          company_id: true,
          scheduled_date: true,
          status: true,
          companies: { select: { name: true } },
        },
      }),
      this.prisma.students.count({ where: { status: 'active' } }),
    ]);

    const placedApps = applications.filter((a) => a.status === 'placed');
    const placedStudentIds = new Set(placedApps.map((a) => a.student_id));
    const companiesCount = new Set(drives.map((d) => d.company_id)).size;

    const packages = placedApps
      .map((a) => this.packageFor(a))
      .filter((p): p is number => p != null);
    const averagePackage =
      packages.length > 0
        ? round2(packages.reduce((a, b) => a + b, 0) / packages.length)
        : null;

    let highest: {
      value: number;
      company_name: string;
      job_role: string | null;
    } | null = null;
    for (const a of placedApps) {
      const value = this.packageFor(a);
      if (value != null && (highest == null || value > highest.value)) {
        highest = {
          value,
          company_name: a.placement_drives.companies.name,
          job_role: a.placement_drives.job_role,
        };
      }
    }

    const offersByStudent = new Map<number, number>();
    for (const a of placedApps) {
      offersByStudent.set(
        a.student_id,
        (offersByStudent.get(a.student_id) ?? 0) + 1,
      );
    }
    const multipleOffersCount = Array.from(offersByStudent.values()).filter(
      (c) => c >= 2,
    ).length;

    const today = startOfToday();
    const monthStart = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
    );
    const monthEnd = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
    );
    const drivesThisMonth = drives.filter(
      (d) => d.scheduled_date >= monthStart && d.scheduled_date <= monthEnd,
    ).length;

    const upcoming = drives
      .filter((d) => d.status === 'scheduled' && d.scheduled_date >= today)
      .sort(
        (a, b) => a.scheduled_date.getTime() - b.scheduled_date.getTime(),
      )[0];

    const departments = await this.departmentBreakdown();
    const leading = departments.reduce<DepartmentPlacement | null>(
      (best, d) => {
        if (d.placement_rate == null) return best;
        if (best == null || d.placement_rate > (best.placement_rate ?? -1))
          return d;
        return best;
      },
      null,
    );

    const eligible = eligibleCount;
    const placed = placedStudentIds.size;

    return {
      companies_count: companiesCount,
      offers_released: placedApps.length,
      average_package: averagePackage,
      highest_package: highest,
      multiple_offers_count: multipleOffersCount,
      drives_this_month: drivesThisMonth,
      next_drive: upcoming
        ? {
            company_name: upcoming.companies.name,
            scheduled_date: toDateOnly(upcoming.scheduled_date),
          }
        : null,
      overall: {
        placed,
        eligible,
        unplaced: eligible - placed,
        percentage: eligible > 0 ? round1((placed / eligible) * 100) : null,
      },
      leading_department: leading
        ? {
            department: leading.department,
            placement_rate: leading.placement_rate,
          }
        : null,
    };
  }

  private async departmentBreakdown(): Promise<DepartmentPlacement[]> {
    const [departments, applications] = await Promise.all([
      this.prisma.departments.findMany({
        select: { id: true, name: true, code: true },
      }),
      this.loadApplications(),
    ]);

    const studentDeptCache = new Map<number, number | null>();
    for (const a of applications) {
      if (!studentDeptCache.has(a.students.id)) {
        studentDeptCache.set(
          a.students.id,
          a.students.classes?.department_id ??
            a.students.courses?.department_id ??
            null,
        );
      }
    }

    const allStudents = await this.prisma.students.findMany({
      where: { status: 'active' },
      select: {
        id: true,
        classes: { select: { department_id: true } },
        courses: { select: { department_id: true } },
      },
    });

    const eligibleByDept = new Map<number, number>();
    for (const s of allStudents) {
      const deptId = s.classes?.department_id ?? s.courses?.department_id;
      if (deptId == null) continue;
      eligibleByDept.set(deptId, (eligibleByDept.get(deptId) ?? 0) + 1);
    }

    const placedByDept = new Map<number, Set<number>>();
    const packagesByDept = new Map<number, number[]>();
    for (const a of applications) {
      if (a.status !== 'placed') continue;
      const deptId = studentDeptCache.get(a.students.id);
      if (deptId == null) continue;
      const set = placedByDept.get(deptId) ?? new Set<number>();
      set.add(a.students.id);
      placedByDept.set(deptId, set);

      const pkg = this.packageFor(a);
      if (pkg != null) {
        const list = packagesByDept.get(deptId) ?? [];
        list.push(pkg);
        packagesByDept.set(deptId, list);
      }
    }

    return departments
      .map((dept) => {
        const eligible = eligibleByDept.get(dept.id) ?? 0;
        const placed = placedByDept.get(dept.id)?.size ?? 0;
        const packages = packagesByDept.get(dept.id) ?? [];
        return {
          department: dept,
          eligible,
          placed,
          unplaced: eligible - placed,
          placement_rate:
            eligible > 0 ? round1((placed / eligible) * 100) : null,
          average_package:
            packages.length > 0
              ? round2(packages.reduce((a, b) => a + b, 0) / packages.length)
              : null,
          highest_package: packages.length > 0 ? Math.max(...packages) : null,
        };
      })
      .sort((a, b) => (b.placement_rate ?? -1) - (a.placement_rate ?? -1));
  }

  /** GET /me/principal/placements/departments — ranked, matching "ordered by placement rate" in the reference design. */
  async listDepartments() {
    const departments = await this.departmentBreakdown();
    return departments.map((d, index) => ({ ...d, rank: index + 1 }));
  }

  /** GET /me/principal/placements/departments/:id */
  async findDepartment(id: number) {
    const [dept, breakdown] = await Promise.all([
      this.prisma.departments.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          code: true,
          faculty_departments_head_of_department_faculty_idTofaculty: {
            select: HOD_SELECT,
          },
        },
      }),
      this.departmentBreakdown(),
    ]);
    if (!dept) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }
    const stats = breakdown.find((d) => d.department.id === id);

    return {
      id: dept.id,
      name: dept.name,
      code: dept.code,
      hod: hodDto(
        dept.faculty_departments_head_of_department_faculty_idTofaculty,
      ),
      eligible: stats?.eligible ?? 0,
      placed: stats?.placed ?? 0,
      unplaced: stats?.unplaced ?? 0,
      placement_rate: stats?.placement_rate ?? null,
      average_package: stats?.average_package ?? null,
      highest_package: stats?.highest_package ?? null,
    };
  }

  /**
   * GET /me/principal/placements/departments/:id/sections
   *
   * "Top recruiter" is a design choice, not something existing code
   * computes: the most-frequent recruiting company among that section's
   * placed students (ties broken by highest package) — a fluke single high
   * offer shouldn't crown a company "top recruiter" for a section it only
   * hired from once.
   */
  async sections(departmentId: number) {
    const dept = await this.prisma.departments.findUnique({
      where: { id: departmentId },
    });
    if (!dept) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId },
      select: {
        id: true,
        section: true,
        current_semester: true,
        class_mentors: {
          orderBy: { id: 'desc' },
          take: 1,
          select: {
            faculty: {
              select: { id: true, first_name: true, last_name: true },
            },
          },
        },
        students: { where: { status: 'active' }, select: { id: true } },
      },
      orderBy: { section: 'asc' },
    });

    const classIds = classes.map((c) => c.id);
    const placedApps = await this.prisma.student_drive_applications.findMany({
      where: { status: 'placed', students: { class_id: { in: classIds } } },
      select: {
        student_id: true,
        offered_package: true,
        students: { select: { class_id: true } },
        placement_drives: {
          select: { package_lpa: true, companies: { select: { name: true } } },
        },
      },
    });

    return classes.map((cls) => {
      const strength = cls.students.length;
      const classApps = placedApps.filter(
        (a) => a.students.class_id === cls.id,
      );
      const placedStudentIds = new Set(classApps.map((a) => a.student_id));
      const packages = classApps
        .map((a) =>
          a.offered_package != null
            ? Number(a.offered_package)
            : a.placement_drives.package_lpa != null
              ? Number(a.placement_drives.package_lpa)
              : null,
        )
        .filter((p): p is number => p != null && p > 0);

      const byCompany = new Map<
        string,
        { count: number; maxPackage: number }
      >();
      for (const a of classApps) {
        const name = a.placement_drives.companies.name;
        const pkg =
          a.offered_package != null
            ? Number(a.offered_package)
            : a.placement_drives.package_lpa != null
              ? Number(a.placement_drives.package_lpa)
              : 0;
        const entry = byCompany.get(name) ?? { count: 0, maxPackage: 0 };
        entry.count += 1;
        entry.maxPackage = Math.max(entry.maxPackage, pkg);
        byCompany.set(name, entry);
      }
      let topRecruiter: string | null = null;
      let topEntry: { count: number; maxPackage: number } | null = null;
      for (const [name, entry] of byCompany.entries()) {
        if (
          !topEntry ||
          entry.count > topEntry.count ||
          (entry.count === topEntry.count &&
            entry.maxPackage > topEntry.maxPackage)
        ) {
          topRecruiter = name;
          topEntry = entry;
        }
      }

      const advisor = cls.class_mentors[0]?.faculty ?? null;

      return {
        id: cls.id,
        section: cls.section,
        semester: cls.current_semester,
        advisor: advisor
          ? {
              faculty_id: advisor.id,
              name: `${advisor.first_name} ${advisor.last_name}`,
            }
          : null,
        strength,
        eligible: strength,
        placed: placedStudentIds.size,
        unplaced: strength - placedStudentIds.size,
        highest_package: packages.length > 0 ? Math.max(...packages) : null,
        average_package:
          packages.length > 0
            ? round2(packages.reduce((a, b) => a + b, 0) / packages.length)
            : null,
        top_recruiter: topRecruiter,
      };
    });
  }

  /**
   * GET /me/principal/placements/recruiters
   *
   * Company-wise leading entries, matching the reference design's
   * RECRUITER/ROLE/OFFERS/PACKAGE table — real, aggregated straight from
   * placed applications, no fabricated "season".
   */
  async leadingRecruiters() {
    const applications = await this.loadApplications();
    const placed = applications.filter((a) => a.status === 'placed');

    const byCompany = new Map<
      number,
      {
        name: string;
        roles: Set<string>;
        offers: number;
        packages: number[];
        departments: Set<string>;
      }
    >();
    for (const a of placed) {
      const company = a.placement_drives.companies;
      const entry = byCompany.get(company.id) ?? {
        name: company.name,
        roles: new Set<string>(),
        offers: 0,
        packages: [],
        departments: new Set<string>(),
      };
      if (a.placement_drives.job_role)
        entry.roles.add(a.placement_drives.job_role);
      entry.offers += 1;
      const pkg = this.packageFor(a);
      if (pkg != null) entry.packages.push(pkg);
      const deptCode =
        a.students.classes?.departments.code ??
        a.students.courses?.departments?.code;
      if (deptCode) entry.departments.add(deptCode);
      byCompany.set(company.id, entry);
    }

    return Array.from(byCompany.entries())
      .map(([companyId, e]) => ({
        company_id: companyId,
        company_name: e.name,
        roles: Array.from(e.roles),
        offers: e.offers,
        average_package:
          e.packages.length > 0
            ? round2(e.packages.reduce((a, b) => a + b, 0) / e.packages.length)
            : null,
        highest_package: e.packages.length > 0 ? Math.max(...e.packages) : null,
        department_codes: Array.from(e.departments),
      }))
      .sort((a, b) => b.offers - a.offers);
  }

  /**
   * GET /me/principal/placements/recruiters/:companyId
   *
   * Every real placed student for one recruiter — the cohort drill-down the
   * reference design opens when a leading-entry row is clicked.
   */
  async recruiterStudents(companyId: number) {
    const company = await this.prisma.companies.findUnique({
      where: { id: companyId },
      select: { name: true },
    });
    if (!company) {
      throw new NotFoundException({
        message: 'Recruiter not found',
        errorCode: 'COMPANY_NOT_FOUND',
      });
    }

    const applications = await this.loadApplications();
    const rows = applications.filter(
      (a) =>
        a.status === 'placed' && a.placement_drives.companies.id === companyId,
    );

    return {
      company_name: company.name,
      students: rows.map((a) => ({
        student_id: a.students.id,
        drive_id: a.placement_drives.id,
        name: this.studentName(a.students),
        roll_no: a.students.student_id_no,
        register_no: a.students.register_no,
        department_code:
          a.students.classes?.departments.code ??
          a.students.courses?.departments?.code ??
          null,
        semester: a.students.classes?.current_semester ?? null,
        job_role: a.placement_drives.job_role,
        package: this.packageFor(a),
        offer_response: a.offer_response ?? null,
        status: a.status,
        updated_at: toDateOnly(a.updated_at),
      })),
    };
  }
}
