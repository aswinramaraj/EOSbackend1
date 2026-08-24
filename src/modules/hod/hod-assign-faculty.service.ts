import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';

function yearLabel(semester: number | null): string {
  if (semester == null) return '—';
  return ['I', 'II', 'III', 'IV'][Math.ceil(semester / 2) - 1] ?? '—';
}

/** Same academic-year convention as HrRequestsService.academicYearFor — duplicated per that file's own precedent rather than shared/exported. */
function currentAcademicYear(): string {
  const now = new Date();
  const calendarYear = now.getUTCFullYear();
  const academicStartYear =
    now.getUTCMonth() + 1 >= 6 ? calendarYear : calendarYear - 1;
  return `${academicStartYear}-${String((academicStartYear + 1) % 100).padStart(2, '0')}`;
}

/**
 * GET /hod/assign-faculty, PATCH .../handling-faculty, PATCH .../substitute-faculty
 * — department-scoped subject-to-faculty assignment for the current
 * academic year. Real tables: `class_subjects` (curriculum — which
 * subjects a class has this semester), `faculty_subject_class_mapping`
 * (the actual assignment, unique on subject_id+class_id+academic_year).
 * Every query sequential (Supabase's session-mode pool caps at 15
 * connections).
 */
@Injectable()
export class HodAssignFacultyService {
  private readonly logger = new Logger(HodAssignFacultyService.name);

  constructor(private readonly prisma: PrismaService) {}

  private async resolveDepartmentId(user: JwtPayload): Promise<number> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!faculty) {
      throw new NotFoundException({
        message: 'No faculty record found for this account.',
        errorCode: 'FACULTY_NOT_FOUND',
      });
    }
    return faculty.department_id;
  }

  private async assertClassInDepartment(classId: number, departmentId: number) {
    const cls = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true },
    });
    if (!cls || cls.department_id !== departmentId) {
      throw new NotFoundException({
        message: 'Class not found in your department.',
        errorCode: 'CLASS_NOT_FOUND',
      });
    }
  }

  async getOverview(user: JwtPayload, classId?: number) {
    const departmentId = await this.resolveDepartmentId(user);
    try {
      const classes = await this.prisma.classes.findMany({
        where: { department_id: departmentId },
        select: { id: true, section: true, current_semester: true },
        orderBy: [{ current_semester: 'asc' }, { section: 'asc' }],
      });

      const facultyOptions = await this.prisma.faculty.findMany({
        where: { department_id: departmentId, status: 'active' },
        select: { id: true, first_name: true, last_name: true },
        orderBy: { first_name: 'asc' },
      });

      const selectedClassId = classId ?? classes[0]?.id ?? null;
      let rows: {
        subject_id: number;
        subject_name: string;
        subject_code: string;
        hours_per_week: number | null;
        mapping_id: number | null;
        handling_faculty_id: number | null;
        handling_faculty_name: string | null;
        substitute_faculty_id: number | null;
        substitute_faculty_name: string | null;
        status: 'assigned' | 'unassigned';
      }[] = [];
      let selectedClassLabel: string | null = null;

      if (selectedClassId != null) {
        const selectedClass = classes.find((c) => c.id === selectedClassId);
        selectedClassLabel = selectedClass
          ? `${yearLabel(selectedClass.current_semester)}-${selectedClass.section}`
          : null;

        const curriculum = await this.prisma.class_subjects.findMany({
          where: { class_id: selectedClassId },
          select: {
            subjects: {
              select: { id: true, name: true, subject_code: true, hours: true },
            },
          },
          orderBy: { subjects: { name: 'asc' } },
        });

        const mappings =
          await this.prisma.faculty_subject_class_mapping.findMany({
            where: {
              class_id: selectedClassId,
              academic_year: currentAcademicYear(),
            },
            select: {
              id: true,
              subject_id: true,
              faculty: {
                select: { id: true, first_name: true, last_name: true },
              },
              substitute_faculty_id: true,
              faculty_faculty_subject_class_mapping_substitute_faculty_idTofaculty:
                {
                  select: { id: true, first_name: true, last_name: true },
                },
            },
          });
        const mappingBySubject = new Map(
          mappings.map((m) => [m.subject_id, m]),
        );

        rows = curriculum.map((c) => {
          const m = mappingBySubject.get(c.subjects.id);
          const handling = m?.faculty;
          const substitute =
            m?.faculty_faculty_subject_class_mapping_substitute_faculty_idTofaculty;
          return {
            subject_id: c.subjects.id,
            subject_name: c.subjects.name,
            subject_code: c.subjects.subject_code,
            hours_per_week: c.subjects.hours,
            mapping_id: m?.id ?? null,
            handling_faculty_id: handling?.id ?? null,
            handling_faculty_name: handling
              ? `${handling.first_name} ${handling.last_name}`.trim()
              : null,
            substitute_faculty_id: substitute?.id ?? null,
            substitute_faculty_name: substitute
              ? `${substitute.first_name} ${substitute.last_name}`.trim()
              : null,
            status: handling ? 'assigned' : 'unassigned',
          };
        });
      }

      return {
        classes: classes.map((c) => ({
          class_id: c.id,
          short_label: `${yearLabel(c.current_semester)}-${c.section}`,
          label: `${yearLabel(c.current_semester)} Year - ${c.section}`,
        })),
        selected_class_id: selectedClassId,
        selected_class_label: selectedClassLabel,
        faculty_options: facultyOptions.map((f) => ({
          faculty_id: f.id,
          name: `${f.first_name} ${f.last_name}`.trim(),
        })),
        rows,
      };
    } catch (err) {
      if (err instanceof NotFoundException) throw err;
      this.logger.error('DB error computing HoD assign-faculty overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async setHandlingFaculty(
    user: JwtPayload,
    classId: number,
    subjectId: number,
    facultyId: number,
  ) {
    const departmentId = await this.resolveDepartmentId(user);
    await this.assertClassInDepartment(classId, departmentId);
    const faculty = await this.prisma.faculty.findUnique({
      where: { id: facultyId },
      select: { department_id: true },
    });
    if (!faculty || faculty.department_id !== departmentId) {
      throw new BadRequestException({
        message: 'That faculty member is not in your department.',
        errorCode: 'FACULTY_OUT_OF_DEPARTMENT',
      });
    }
    try {
      await this.prisma.faculty_subject_class_mapping.upsert({
        where: {
          subject_id_class_id_academic_year: {
            subject_id: subjectId,
            class_id: classId,
            academic_year: currentAcademicYear(),
          },
        },
        create: {
          subject_id: subjectId,
          class_id: classId,
          academic_year: currentAcademicYear(),
          faculty_id: facultyId,
          assigned_by_user_id: user.sub,
        },
        update: { faculty_id: facultyId, assigned_by_user_id: user.sub },
      });
      return { success: true };
    } catch (err) {
      this.logger.error('DB error setting HoD handling faculty', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async setSubstituteFaculty(
    user: JwtPayload,
    classId: number,
    subjectId: number,
    facultyId: number | null,
  ) {
    const departmentId = await this.resolveDepartmentId(user);
    await this.assertClassInDepartment(classId, departmentId);
    if (facultyId != null) {
      const faculty = await this.prisma.faculty.findUnique({
        where: { id: facultyId },
        select: { department_id: true },
      });
      if (!faculty || faculty.department_id !== departmentId) {
        throw new BadRequestException({
          message: 'That faculty member is not in your department.',
          errorCode: 'FACULTY_OUT_OF_DEPARTMENT',
        });
      }
    }
    const existing = await this.prisma.faculty_subject_class_mapping.findUnique(
      {
        where: {
          subject_id_class_id_academic_year: {
            subject_id: subjectId,
            class_id: classId,
            academic_year: currentAcademicYear(),
          },
        },
        select: { id: true },
      },
    );
    if (!existing) {
      throw new BadRequestException({
        message: 'Assign a handling faculty before setting a substitute.',
        errorCode: 'NO_HANDLING_FACULTY',
      });
    }
    try {
      await this.prisma.faculty_subject_class_mapping.update({
        where: { id: existing.id },
        data: { substitute_faculty_id: facultyId },
      });
      return { success: true };
    } catch (err) {
      this.logger.error('DB error setting HoD substitute faculty', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
