import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

/** Same academic-year convention used elsewhere in this codebase (e.g. hr-requests.service.ts). */
function currentAcademicYear(): string {
  const now = new Date();
  const calendarYear = now.getUTCFullYear();
  const academicStartYear =
    now.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
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
export class HodNoDueService {
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

  /** GET /hod/no-due/classes — for the class filter dropdown. */
  async getClasses(userId: number) {
    const { department } = await this.resolveHodDepartment(userId);
    const classes = await this.prisma.classes.findMany({
      where: { department_id: department.id, current_semester: { not: null } },
      select: { id: true, section: true, current_semester: true },
      orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
    });
    return classes.map((c) => ({
      class_id: c.id,
      section: c.section,
      semester: c.current_semester as number,
      year_label: yearLabelForSemester(c.current_semester as number),
    }));
  }

  private async fetchStatusRows(studentIds: number[], academicYear: string) {
    if (studentIds.length === 0) return [];
    return this.prisma.student_no_due_status.findMany({
      where: { student_id: { in: studentIds }, academic_year: academicYear },
      select: {
        student_id: true,
        library_cleared: true,
        laboratory_cleared: true,
        fees_cleared: true,
        hostel_cleared: true,
        sports_cleared: true,
        issued_at: true,
      },
    });
  }

  /** GET /hod/no-due?class_id=&search= */
  async getList(userId: number, classId: number, search?: string) {
    const { department } = await this.resolveHodDepartment(userId);

    const klass = await this.prisma.classes.findFirst({
      where: { id: classId, department_id: department.id },
      select: { id: true, section: true, current_semester: true },
    });
    if (!klass) {
      throw new NotFoundException('Class not found in this department');
    }

    const students = await this.prisma.students.findMany({
      where: {
        class_id: klass.id,
        status: 'active',
        OR: search
          ? [
              { student_id_no: { contains: search, mode: 'insensitive' } },
              {
                soa_applications: {
                  OR: [
                    { first_name: { contains: search, mode: 'insensitive' } },
                    { last_name: { contains: search, mode: 'insensitive' } },
                  ],
                },
              },
            ]
          : undefined,
      },
      select: {
        id: true,
        student_id_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
      },
      orderBy: { student_id_no: 'asc' },
    });

    const academicYear = currentAcademicYear();
    const statusRows = await this.fetchStatusRows(
      students.map((s) => s.id),
      academicYear,
    );
    const statusByStudent = new Map(statusRows.map((r) => [r.student_id, r]));

    const classLabel =
      klass.current_semester != null
        ? `${yearLabelForSemester(klass.current_semester)}-${klass.section}`
        : klass.section;

    let issuedCount = 0;
    const rows = students.map((s) => {
      const status = statusByStudent.get(s.id);
      const issued = status?.issued_at != null;
      if (issued) issuedCount += 1;
      return {
        student_id: s.id,
        student_id_no: s.student_id_no,
        name: studentName(s.soa_applications),
        class_label: classLabel,
        library_cleared: status?.library_cleared ?? false,
        laboratory_cleared: status?.laboratory_cleared ?? false,
        fees_cleared: status?.fees_cleared ?? false,
        hostel_cleared: status?.hostel_cleared ?? false,
        sports_cleared: status?.sports_cleared ?? false,
        issued: issued,
      };
    });

    return {
      department,
      class: { id: klass.id, label: classLabel },
      academic_year: academicYear,
      counts: {
        in_scope: rows.length,
        issued: issuedCount,
        pending: rows.length - issuedCount,
      },
      rows,
    };
  }

  /**
   * PATCH /hod/no-due/:studentId — upserts the per-category ticks and/or
   * marks the clearance as issued. `issue: true` always stamps issued_at
   * (and, per the "Tick all & issue" action, is sent together with every
   * category flag forced true) — there's no separate validation requiring
   * every category to already be true first, since the HOD's own sign-off
   * is what "issuing" means here.
   */
  async updateStatus(
    userId: number,
    studentId: number,
    patch: {
      library_cleared?: boolean;
      laboratory_cleared?: boolean;
      fees_cleared?: boolean;
      hostel_cleared?: boolean;
      sports_cleared?: boolean;
      issue?: boolean;
    },
  ) {
    const { department } = await this.resolveHodDepartment(userId);

    const student = await this.prisma.students.findFirst({
      where: { id: studentId, classes: { department_id: department.id } },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException('Student not found in this department');
    }

    const academicYear = currentAcademicYear();

    // Merge onto whatever's already stored — a PATCH toggling just one
    // category (the per-dot "Edit" interaction) must not blank out the
    // other four, which a plain default-to-false upsert would do.
    const [existing] = await this.fetchStatusRows([studentId], academicYear);
    const library = patch.library_cleared ?? existing?.library_cleared ?? false;
    const laboratory =
      patch.laboratory_cleared ?? existing?.laboratory_cleared ?? false;
    const fees = patch.fees_cleared ?? existing?.fees_cleared ?? false;
    const hostel = patch.hostel_cleared ?? existing?.hostel_cleared ?? false;
    const sports = patch.sports_cleared ?? existing?.sports_cleared ?? false;
    const issuedAt = patch.issue ? new Date() : (existing?.issued_at ?? null);

    await this.prisma.student_no_due_status.upsert({
      where: {
        student_id_academic_year: { student_id: studentId, academic_year: academicYear },
      },
      create: {
        student_id: studentId,
        academic_year: academicYear,
        library_cleared: library,
        laboratory_cleared: laboratory,
        fees_cleared: fees,
        hostel_cleared: hostel,
        sports_cleared: sports,
        issued_at: issuedAt,
        issued_by_user_id: patch.issue ? userId : null,
      },
      update: {
        library_cleared: library,
        laboratory_cleared: laboratory,
        fees_cleared: fees,
        hostel_cleared: hostel,
        sports_cleared: sports,
        issued_at: issuedAt,
        updated_at: new Date(),
        ...(patch.issue ? { issued_by_user_id: userId } : {}),
      },
    });

    return {
      student_id: studentId,
      ...patch,
      issued: patch.issue ?? undefined,
    };
  }
}
