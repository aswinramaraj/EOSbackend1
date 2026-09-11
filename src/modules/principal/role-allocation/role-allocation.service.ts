import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/** Same Odd/Even convention duplicated per-service elsewhere in this module (see principal/departments/departments.service.ts, principal/faculty/faculty.service.ts) — kept local rather than shared, matching that existing precedent. */
function currentTermRange(today: Date): { start: Date; end: Date } {
  const calendarYear = today.getUTCFullYear();
  const month = today.getUTCMonth() + 1;
  if (month >= 7) {
    return {
      start: new Date(Date.UTC(calendarYear, 6, 1)),
      end: new Date(Date.UTC(calendarYear, 11, 31)),
    };
  }
  return {
    start: new Date(Date.UTC(calendarYear, 0, 1)),
    end: new Date(Date.UTC(calendarYear, 5, 30)),
  };
}

function startOfToday(): Date {
  return new Date(new Date().toISOString().slice(0, 10));
}

interface AuditValue {
  faculty_id: number | null;
}

@Injectable()
export class RoleAllocationService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/principal/role-allocation/departments
   *
   * One card per department: headcounts, and the current HoD (from the real
   * head_of_department_faculty_id FK — see PrincipalDepartmentsService.list's
   * own note on why this is the only trustworthy source). `hod.since` is only
   * populated when an audit_logs row for this exact appointment exists —
   * legacy/seed-assigned HoDs that predate audit logging show `since: null`
   * rather than a fabricated date.
   */
  async listDepartments() {
    const [departments, facultyCounts, professorCounts] = await Promise.all([
      this.prisma.departments.findMany({
        select: {
          id: true,
          name: true,
          code: true,
          faculty_departments_head_of_department_faculty_idTofaculty: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              staff_code: true,
              designation: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.faculty.groupBy({
        by: ['department_id'],
        where: { status: 'active' },
        _count: { _all: true },
      }),
      // Exact match only ("Professor", case-insensitive) — designation is
      // free text, so a substring match would also catch "Assistant
      // Professor"/"Associate Professor", which are not the same rank.
      this.prisma.faculty.groupBy({
        by: ['department_id'],
        where: {
          status: 'active',
          designation: { equals: 'Professor', mode: 'insensitive' },
        },
        _count: { _all: true },
      }),
    ]);

    const facultyCountByDept = new Map(
      facultyCounts.map((f) => [f.department_id, f._count._all]),
    );
    const professorCountByDept = new Map(
      professorCounts.map((f) => [f.department_id, f._count._all]),
    );

    const hodSinceByDept = await this.currentHodSinceMap(
      departments.map((d) => ({
        deptId: d.id,
        hodFacultyId:
          d.faculty_departments_head_of_department_faculty_idTofaculty?.id ??
          null,
      })),
    );

    return departments.map((dept) => {
      const hodRow =
        dept.faculty_departments_head_of_department_faculty_idTofaculty;
      return {
        id: dept.id,
        code: dept.code,
        name: dept.name,
        faculty_count: facultyCountByDept.get(dept.id) ?? 0,
        professor_count: professorCountByDept.get(dept.id) ?? 0,
        hod: hodRow
          ? {
              faculty_id: hodRow.id,
              name: `${hodRow.first_name} ${hodRow.last_name}`,
              staff_code: hodRow.staff_code,
              designation: hodRow.designation,
              since: hodSinceByDept.get(dept.id) ?? null,
            }
          : null,
      };
    });
  }

  /**
   * GET /me/principal/role-allocation/departments/:id/candidates
   *
   * Every active faculty member in the department, ranked material for the
   * appointment decision: experience, this-term attendance, and all-time
   * publication count — same formulas as PrincipalFacultyService.list(), not
   * imported (see that service's own note: this codebase duplicates these
   * small per-service rather than sharing them across principal/* modules).
   */
  async candidatesForDepartment(departmentId: number) {
    const dept = await this.prisma.departments.findUnique({
      where: { id: departmentId },
      select: { id: true, head_of_department_faculty_id: true },
    });
    if (!dept) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    const rows = await this.prisma.faculty.findMany({
      where: { department_id: departmentId, status: 'active' },
      select: {
        id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        staff_code: true,
        designation: true,
        qualification: true,
        date_of_joining: true,
        previous_experience_years: true,
      },
      orderBy: { id: 'asc' },
    });

    const ids = rows.map((r) => r.id);
    const [attendanceByFaculty, publicationsByFaculty, hodSinceByDept] =
      await Promise.all([
        this.attendanceByFaculty(ids),
        this.publicationsByFaculty(ids),
        this.currentHodSinceMap([
          { deptId: dept.id, hodFacultyId: dept.head_of_department_faculty_id },
        ]),
      ]);
    const hodSince = hodSinceByDept.get(dept.id) ?? null;

    return rows.map((row) => ({
      id: row.id,
      name: [row.prefix, row.first_name, row.last_name]
        .filter(Boolean)
        .join(' '),
      staff_code: row.staff_code,
      designation: row.designation,
      qualification: row.qualification,
      experience_years: this.experienceYears(
        row.date_of_joining,
        row.previous_experience_years,
      ),
      attendance_percentage: attendanceByFaculty.get(row.id) ?? null,
      publications_count: publicationsByFaculty.get(row.id) ?? 0,
      is_current_hod: row.id === dept.head_of_department_faculty_id,
      hod_since:
        row.id === dept.head_of_department_faculty_id ? hodSince : null,
    }));
  }

  /**
   * GET /me/principal/role-allocation/departments/:id/history
   *
   * Backed by audit_logs (entity_type 'department_hod'), written by
   * PrincipalDepartmentsService.assignHod() — see that method. Empty until
   * the first appointment made through this feature; nothing here is
   * back-filled for HoDs assigned before audit logging existed.
   */
  async historyForDepartment(departmentId: number) {
    const dept = await this.prisma.departments.findUnique({
      where: { id: departmentId },
      select: { id: true },
    });
    if (!dept) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    const rows = await this.prisma.audit_logs.findMany({
      where: { entity_type: 'department_hod', entity_id: departmentId },
      orderBy: { performed_at: 'desc' },
      take: 5,
      select: {
        old_value: true,
        new_value: true,
        reason: true,
        performed_at: true,
        performed_by_user_id: true,
      },
    });
    if (rows.length === 0) return [];

    const facultyIds = new Set<number>();
    for (const r of rows) {
      const oldId = (r.old_value as AuditValue | null)?.faculty_id;
      const newId = (r.new_value as AuditValue | null)?.faculty_id;
      if (typeof oldId === 'number') facultyIds.add(oldId);
      if (typeof newId === 'number') facultyIds.add(newId);
    }

    const [facultyRows, changedByNames] = await Promise.all([
      this.prisma.faculty.findMany({
        where: { id: { in: [...facultyIds] } },
        select: { id: true, first_name: true, last_name: true },
      }),
      this.resolveUserNames([
        ...new Set(rows.map((r) => r.performed_by_user_id)),
      ]),
    ]);
    const facultyNameById = new Map(
      facultyRows.map((f) => [f.id, `${f.first_name} ${f.last_name}`]),
    );

    return rows.map((r) => {
      const oldId = (r.old_value as AuditValue | null)?.faculty_id;
      const newId = (r.new_value as AuditValue | null)?.faculty_id;
      return {
        date: r.performed_at.toISOString(),
        from:
          typeof oldId === 'number'
            ? (facultyNameById.get(oldId) ?? 'Unknown faculty')
            : 'No HoD assigned',
        to:
          typeof newId === 'number'
            ? (facultyNameById.get(newId) ?? 'Unknown faculty')
            : 'No HoD assigned',
        reason: r.reason,
        changed_by:
          changedByNames.get(r.performed_by_user_id) ?? 'Unknown',
      };
    });
  }

  /**
   * Most recent audit_logs row (if any) whose new_value.faculty_id matches
   * each department's CURRENT head_of_department_faculty_id — this is what
   * makes "since" honest: if the HoD has changed again since that log row,
   * or the row doesn't exist, this correctly yields no match rather than a
   * stale or invented date.
   */
  private async currentHodSinceMap(
    depts: { deptId: number; hodFacultyId: number | null }[],
  ): Promise<Map<number, string>> {
    const deptIds = depts
      .filter((d) => d.hodFacultyId != null)
      .map((d) => d.deptId);
    if (deptIds.length === 0) return new Map();

    const rows = await this.prisma.audit_logs.findMany({
      where: { entity_type: 'department_hod', entity_id: { in: deptIds } },
      orderBy: { performed_at: 'desc' },
      select: { entity_id: true, new_value: true, performed_at: true },
    });

    const result = new Map<number, string>();
    for (const dept of depts) {
      if (dept.hodFacultyId == null) continue;
      const match = rows.find(
        (r) =>
          r.entity_id === dept.deptId &&
          (r.new_value as AuditValue | null)?.faculty_id ===
            dept.hodFacultyId,
      );
      if (match) result.set(dept.deptId, match.performed_at.toISOString());
    }
    return result;
  }

  /**
   * user_id -> display name, faculty -> non_teaching_staff -> email order
   * (same priority the rest of the codebase uses — see
   * announcements.service.ts's toResponseShape poster resolution). The actor
   * here is always a Principal, who is a faculty row in every real account on
   * file (see profile.controller.ts's GET /me/my-profile), so the faculty
   * branch is expected to resolve every real row; the other two are honest
   * fallbacks, not dead code.
   */
  private async resolveUserNames(
    userIds: number[],
  ): Promise<Map<number, string>> {
    if (userIds.length === 0) return new Map();
    const [facultyRows, staffRows, userRows] = await Promise.all([
      this.prisma.faculty.findMany({
        where: { user_id: { in: userIds } },
        select: { user_id: true, first_name: true, last_name: true },
      }),
      this.prisma.non_teaching_staff.findMany({
        where: { user_id: { in: userIds } },
        select: { user_id: true, first_name: true, last_name: true },
      }),
      this.prisma.users.findMany({
        where: { id: { in: userIds } },
        select: { id: true, email: true },
      }),
    ]);

    const result = new Map<number, string>();
    for (const u of userRows) result.set(u.id, u.email);
    for (const s of staffRows) {
      if (s.user_id != null) {
        result.set(s.user_id, [s.first_name, s.last_name].filter(Boolean).join(' '));
      }
    }
    for (const f of facultyRows) {
      if (f.user_id != null) {
        result.set(f.user_id, `${f.first_name} ${f.last_name}`);
      }
    }
    return result;
  }

  /** Tenure since date_of_joining, plus any prior-institution experience on file — identical formula to PrincipalFacultyService.experienceYears(). */
  private experienceYears(
    dateOfJoining: Date | null,
    previousExperienceYears: number | null,
  ): number | null {
    if (!dateOfJoining) return null;
    const tenureYears =
      (Date.now() - dateOfJoining.getTime()) / (365.25 * 24 * 3600 * 1000);
    return Math.round((tenureYears + (previousExperienceYears ?? 0)) * 10) / 10;
  }

  /** Attendance % this term — identical formula to PrincipalFacultyService.attendanceByFaculty(). */
  private async attendanceByFaculty(
    facultyIds: number[],
  ): Promise<Map<number, number>> {
    if (facultyIds.length === 0) return new Map();
    const { start, end } = currentTermRange(startOfToday());
    const records = await this.prisma.faculty_daily_attendance.findMany({
      where: {
        faculty_id: { in: facultyIds },
        attendance_date: { gte: start, lte: end },
        status: { in: ['full_day', 'half_day', 'absent'] },
      },
      select: { faculty_id: true, status: true },
    });

    const byFaculty = new Map<number, { earned: number; total: number }>();
    for (const r of records) {
      const facultyId = r.faculty_id!;
      const entry = byFaculty.get(facultyId) ?? { earned: 0, total: 0 };
      entry.total += 1;
      if (r.status === 'full_day') entry.earned += 1;
      else if (r.status === 'half_day') entry.earned += 0.5;
      byFaculty.set(facultyId, entry);
    }

    const result = new Map<number, number>();
    for (const [facultyId, entry] of byFaculty.entries()) {
      if (entry.total > 0) {
        result.set(facultyId, Math.round((entry.earned / entry.total) * 1000) / 10);
      }
    }
    return result;
  }

  /** All-time publication count per faculty — identical query to PrincipalFacultyService.publicationsByFaculty(). */
  private async publicationsByFaculty(
    facultyIds: number[],
  ): Promise<Map<number, number>> {
    if (facultyIds.length === 0) return new Map();
    const rows = await this.prisma.faculty_publications.groupBy({
      by: ['faculty_id'],
      where: { faculty_id: { in: facultyIds } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.faculty_id, r._count._all]));
  }
}
