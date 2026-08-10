import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateFacultyMappingDto } from './dto/create-faculty-mapping.dto';
import { UpdateFacultyMappingDto } from './dto/update-faculty-mapping.dto';
import { ListFacultyMappingQueryDto } from './dto/list-faculty-mapping-query.dto';

function prismaErrorCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null && 'code' in err
    ? (err as { code?: string }).code
    : undefined;
}

const MAPPING_SELECT = {
  id: true,
  academic_year: true,
  faculty: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
      designation: true,
      profile_url: true,
    },
  },
  classes: {
    select: {
      id: true,
      section: true,
      departments: { select: { id: true, name: true, code: true } },
    },
  },
  subjects: { select: { id: true, name: true, subject_code: true } },
} as const;

interface MappingRow {
  id: number;
  academic_year: string;
  faculty: {
    id: number;
    first_name: string;
    last_name: string;
    designation: string;
    profile_url: string | null;
  };
  classes: {
    id: number;
    section: string;
    departments: { id: number; name: string; code: string };
  };
  subjects: { id: number; name: string; subject_code: string };
}

function toResponse(mapping: MappingRow) {
  return {
    id: mapping.id,
    academic_year: mapping.academic_year,
    faculty: mapping.faculty,
    class: {
      id: mapping.classes.id,
      section: mapping.classes.section,
      department: mapping.classes.departments,
    },
    subject: mapping.subjects,
  };
}

@Injectable()
export class FacultyMappingService {
  private readonly logger = new Logger(FacultyMappingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /faculty-mapping (HoD only, own department).
   *
   * workflow.md describes subject-assignment and mentor-assignment as the
   * same kind of HoD duty (lines 74-76, back to back) — Class Mentors
   * enforces "own department only" for that sibling action, so this mirrors
   * it for consistency: the HoD may only map faculty within classes that
   * belong to their own department. No restriction on the faculty side —
   * neither schema nor workflow.md requires the assigned faculty to also
   * belong to that department.
   *
   * workflow.md also says LMS notes are "created automatically when the
   * faculty is mapped to a subject of the respective class" — lms_notes.title
   * is required and non-null with no default, so a real title is synthesized
   * here from the subject's own name. Both inserts happen in one transaction
   * so the note can never exist without its mapping (or vice versa). Only
   * fires on a brand-new mapping (not update()) — this is the literal
   * "faculty is mapped" event. Note: since lms_notes has no academic_year
   * column and no unique constraint, re-mapping the same faculty to the same
   * subject+class in a later academic year creates another placeholder note
   * rather than reusing the old one — an inherent limit of this schema, not
   * something worked around here.
   */
  async create(dto: CreateFacultyMappingDto, hodUserId: number) {
    const hod = await this.resolveFacultyByUserId(hodUserId);

    const { klass, subject } = await this.assertForeignKeysExist(
      dto.faculty_id,
      dto.subject_id,
      dto.class_id,
    );
    this.assertClassInDepartment(klass, hod.department_id);

    await this.assertNoDuplicateMapping(
      dto.subject_id,
      dto.class_id,
      dto.academic_year,
    );

    try {
      const mapping = await this.prisma.$transaction(async (tx) => {
        const created = await tx.faculty_subject_class_mapping.create({
          data: {
            faculty_id: dto.faculty_id,
            subject_id: dto.subject_id,
            class_id: dto.class_id,
            academic_year: dto.academic_year,
            assigned_by_user_id: hodUserId,
          },
          select: MAPPING_SELECT,
        });

        await tx.lms_notes.create({
          data: {
            faculty_id: dto.faculty_id,
            subject_id: dto.subject_id,
            class_id: dto.class_id,
            title: `${subject.name} — Course Notes`,
          },
        });

        return created;
      });

      this.logger.log(
        `Faculty mapping created: id=${mapping.id} (auto-created LMS note for subject=${dto.subject_id} class=${dto.class_id})`,
      );
      return toResponse(mapping);
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2002') {
        throw new ConflictException(
          'This subject is already mapped to this class for the given academic year',
        );
      }
      throw err;
    }
  }

  /** GET /faculty-mapping (Admin/HoD/Faculty) — paginated, optionally filtered. */
  async findAll(query: ListFacultyMappingQueryDto) {
    const where = {
      faculty_id: query.faculty_id,
      class_id: query.class_id,
      subject_id: query.subject_id,
      academic_year: query.academic_year,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.faculty_subject_class_mapping.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { id: 'asc' },
        select: MAPPING_SELECT,
      }),
      this.prisma.faculty_subject_class_mapping.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /faculty-mapping/:id (Admin/HoD/Faculty). */
  async findOne(id: number) {
    const mapping = await this.prisma.faculty_subject_class_mapping.findUnique({
      where: { id },
      select: MAPPING_SELECT,
    });

    if (!mapping) {
      throw new NotFoundException('Faculty mapping not found');
    }

    return toResponse(mapping);
  }

  /** PATCH /faculty-mapping/:id (HoD only, own department — see create() for why). */
  async update(id: number, dto: UpdateFacultyMappingDto, hodUserId: number) {
    if (!dto || Object.keys(dto).length === 0) {
      throw new BadRequestException('No fields provided to update');
    }

    const hod = await this.resolveFacultyByUserId(hodUserId);

    const existing = await this.prisma.faculty_subject_class_mapping.findUnique(
      {
        where: { id },
        select: {
          faculty_id: true,
          subject_id: true,
          class_id: true,
          academic_year: true,
        },
      },
    );

    if (!existing) {
      throw new NotFoundException('Faculty mapping not found');
    }

    const { klass } = await this.assertForeignKeysExist(
      dto.faculty_id ?? existing.faculty_id,
      dto.subject_id ?? existing.subject_id,
      dto.class_id ?? existing.class_id,
    );
    this.assertClassInDepartment(klass, hod.department_id);

    await this.assertNoDuplicateMapping(
      dto.subject_id ?? existing.subject_id,
      dto.class_id ?? existing.class_id,
      dto.academic_year ?? existing.academic_year,
      id,
    );

    try {
      const mapping = await this.prisma.faculty_subject_class_mapping.update({
        where: { id },
        data: {
          faculty_id: dto.faculty_id,
          subject_id: dto.subject_id,
          class_id: dto.class_id,
          academic_year: dto.academic_year,
        },
        select: MAPPING_SELECT,
      });

      return toResponse(mapping);
    } catch (err: unknown) {
      if (prismaErrorCode(err) === 'P2025') {
        throw new NotFoundException('Faculty mapping not found');
      }
      throw err;
    }
  }

  /**
   * DELETE /faculty-mapping/:id (HoD only, own department — see create()).
   * The schema has no soft-delete flag on this table, so this is a hard delete.
   */
  async remove(id: number, hodUserId: number) {
    const hod = await this.resolveFacultyByUserId(hodUserId);

    const existing = await this.prisma.faculty_subject_class_mapping.findUnique(
      {
        where: { id },
        select: { class_id: true },
      },
    );
    if (!existing) {
      throw new NotFoundException('Faculty mapping not found');
    }

    const klass = await this.prisma.classes.findUnique({
      where: { id: existing.class_id },
    });
    if (!klass) {
      throw new NotFoundException('Class not found');
    }
    this.assertClassInDepartment(klass, hod.department_id);

    await this.prisma.faculty_subject_class_mapping.delete({ where: { id } });

    this.logger.log(`Faculty mapping deleted: id=${id}`);
    return { id, deleted: true };
  }

  private async assertForeignKeysExist(
    facultyId: number,
    subjectId: number,
    classId: number,
  ) {
    const [faculty, subject, klass] = await Promise.all([
      this.prisma.faculty.findUnique({ where: { id: facultyId } }),
      this.prisma.subjects.findUnique({ where: { id: subjectId } }),
      this.prisma.classes.findUnique({ where: { id: classId } }),
    ]);

    if (!faculty) {
      throw new NotFoundException('Faculty not found');
    }
    if (!subject) {
      throw new NotFoundException('Subject not found');
    }
    if (!klass) {
      throw new NotFoundException('Class not found');
    }

    return { faculty, subject, klass };
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

  private assertClassInDepartment(
    klass: { department_id: number },
    departmentId: number,
  ) {
    if (klass.department_id !== departmentId) {
      throw new ForbiddenException({
        message:
          'You can only manage faculty mappings within your own department',
        errorCode: 'DEPARTMENT_SCOPE_VIOLATION',
      });
    }
  }

  /**
   * Mirrors the DB's own @@unique([subject_id, class_id, academic_year]) —
   * only one faculty may be mapped to a given subject+class in a given
   * academic year. `excludeId` lets update() ignore the row being updated.
   */
  private async assertNoDuplicateMapping(
    subjectId: number,
    classId: number,
    academicYear: string,
    excludeId?: number,
  ) {
    const conflicting =
      await this.prisma.faculty_subject_class_mapping.findUnique({
        where: {
          subject_id_class_id_academic_year: {
            subject_id: subjectId,
            class_id: classId,
            academic_year: academicYear,
          },
        },
        select: { id: true },
      });

    if (conflicting && conflicting.id !== excludeId) {
      throw new ConflictException(
        'This subject is already mapped to this class for the given academic year',
      );
    }
  }
}
