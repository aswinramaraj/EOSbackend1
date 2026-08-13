import {
  Injectable,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

/** Same academic-year convention used elsewhere (e.g. hod-faculty-staff.service.ts) — an academic year starts in June. */
function academicYearFor(date: Date): string {
  const calendarYear = date.getUTCFullYear();
  const academicStartYear =
    date.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}

function fullName(f: {
  prefix?: string | null;
  first_name: string;
  last_name: string;
}): string {
  return [f.prefix, f.first_name, f.last_name].filter(Boolean).join(' ');
}

@Injectable()
export class HodAssignFacultyService {
  constructor(private readonly prisma: PrismaService) {}

  private async resolveHodDepartment(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  private async getDepartmentClasses(departmentId: number) {
    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId, current_semester: { not: null } },
      select: {
        id: true,
        section: true,
        current_semester: true,
      },
      orderBy: [{ current_semester: 'desc' }, { section: 'asc' }],
    });
    return classes.map((c) => {
      const yearLabel = yearLabelForSemester(c.current_semester as number);
      return {
        class_id: c.id,
        section: c.section,
        semester: c.current_semester as number,
        short_label: `${yearLabel}-${c.section}`,
        label: `${yearLabel}-${c.section} · ${yearLabel} Year, Section ${c.section}`,
      };
    });
  }

  /** GET /hod/assign-faculty?class_id= */
  async getAssignments(userId: number, classId?: number) {
    const hod = await this.resolveHodDepartment(userId);
    const classes = await this.getDepartmentClasses(hod.department_id);
    if (classes.length === 0) {
      return {
        classes: [],
        selected_class_id: null,
        faculty_options: [],
        rows: [],
      };
    }

    const selected =
      classes.find((c) => c.class_id === classId) ?? classes[0];

    const facultyRows = await this.prisma.faculty.findMany({
      where: { department_id: hod.department_id, status: 'active' },
      select: { id: true, prefix: true, first_name: true, last_name: true },
      orderBy: { first_name: 'asc' },
    });
    const facultyOptions = facultyRows.map((f) => ({
      faculty_id: f.id,
      name: fullName(f),
    }));

    const academicYear = academicYearFor(new Date());

    const [classSubjects, mappings] = await Promise.all([
      this.prisma.class_subjects.findMany({
        where: { class_id: selected.class_id, semester: selected.semester },
        select: {
          subject_id: true,
          subjects: {
            select: { id: true, name: true, subject_code: true, hours: true },
          },
        },
        orderBy: { subject_id: 'asc' },
      }),
      this.prisma.faculty_subject_class_mapping.findMany({
        where: { class_id: selected.class_id, academic_year: academicYear },
        select: {
          id: true,
          subject_id: true,
          faculty: { select: { id: true, prefix: true, first_name: true, last_name: true } },
          faculty_faculty_subject_class_mapping_substitute_faculty_idTofaculty: {
            select: { id: true, prefix: true, first_name: true, last_name: true },
          },
        },
      }),
    ]);

    const mappingBySubject = new Map(mappings.map((m) => [m.subject_id, m]));

    const rows = classSubjects.map((cs) => {
      const mapping = mappingBySubject.get(cs.subject_id) ?? null;
      const substitute =
        mapping?.faculty_faculty_subject_class_mapping_substitute_faculty_idTofaculty ??
        null;
      return {
        subject_id: cs.subjects.id,
        subject_name: cs.subjects.name,
        subject_code: cs.subjects.subject_code,
        hours_per_week: cs.subjects.hours,
        mapping_id: mapping?.id ?? null,
        handling_faculty_id: mapping?.faculty.id ?? null,
        handling_faculty_name: mapping ? fullName(mapping.faculty) : null,
        substitute_faculty_id: substitute?.id ?? null,
        substitute_faculty_name: substitute ? fullName(substitute) : null,
        status: mapping ? ('assigned' as const) : ('unassigned' as const),
      };
    });

    return {
      classes: classes.map((c) => ({
        class_id: c.class_id,
        short_label: c.short_label,
        label: c.label,
      })),
      selected_class_id: selected.class_id,
      selected_class_label: selected.short_label,
      faculty_options: facultyOptions,
      rows,
    };
  }

  /** PATCH /hod/assign-faculty/handling-faculty — creates or updates the (subject, class, academic_year) mapping. */
  async setHandlingFaculty(
    userId: number,
    classId: number,
    subjectId: number,
    facultyId: number,
  ) {
    const hod = await this.resolveHodDepartment(userId);

    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true },
    });
    if (!klass || klass.department_id !== hod.department_id) {
      throw new ForbiddenException('This class is not in your department');
    }
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { department_id: true },
    });
    if (!faculty || faculty.department_id !== hod.department_id) {
      throw new ForbiddenException('This faculty is not in your department');
    }

    const academicYear = academicYearFor(new Date());
    await this.prisma.faculty_subject_class_mapping.upsert({
      where: {
        subject_id_class_id_academic_year: {
          subject_id: subjectId,
          class_id: classId,
          academic_year: academicYear,
        },
      },
      create: {
        subject_id: subjectId,
        class_id: classId,
        academic_year: academicYear,
        faculty_id: facultyId,
        assigned_by_user_id: userId,
      },
      update: { faculty_id: facultyId, assigned_by_user_id: userId },
    });

    return { status: 'ok' as const };
  }

  /**
   * PATCH /hod/assign-faculty/substitute-faculty — sets or clears the
   * substitute on an existing (subject, class, academic_year) mapping.
   * facultyId of null clears the substitute. Requires a handling faculty to
   * already be assigned (a substitute stands in for someone).
   */
  async setSubstituteFaculty(
    userId: number,
    classId: number,
    subjectId: number,
    facultyId: number | null,
  ) {
    const hod = await this.resolveHodDepartment(userId);

    const klass = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true },
    });
    if (!klass || klass.department_id !== hod.department_id) {
      throw new ForbiddenException('This class is not in your department');
    }

    if (facultyId != null) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: facultyId },
        select: { department_id: true },
      });
      if (!faculty || faculty.department_id !== hod.department_id) {
        throw new ForbiddenException('This faculty is not in your department');
      }
    }

    const academicYear = academicYearFor(new Date());
    const mapping = await this.prisma.faculty_subject_class_mapping.findUnique({
      where: {
        subject_id_class_id_academic_year: {
          subject_id: subjectId,
          class_id: classId,
          academic_year: academicYear,
        },
      },
      select: { id: true },
    });
    if (!mapping) {
      throw new BadRequestException(
        'Assign a handling faculty for this subject before allotting a substitute',
      );
    }

    await this.prisma.faculty_subject_class_mapping.update({
      where: { id: mapping.id },
      data: { substitute_faculty_id: facultyId },
    });

    return { status: 'ok' as const };
  }
}
