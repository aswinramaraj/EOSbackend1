import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { EnterExamMarksDto } from './dto/enter-exam-marks.dto';
import { UpdateExamMarkDto } from './dto/update-exam-mark.dto';
import { ListExamMarksQueryDto } from './dto/list-exam-marks-query.dto';
import { ValidateExamMarksDto } from './dto/validate-exam-marks.dto';

const EXAM_MARK_SELECT = {
  id: true,
  marks_obtained: true,
  max_marks: true,
  is_absent: true,
  entered_at: true,
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
      users: { select: { email: true } },
    },
  },
  exam_subject_mapping: {
    select: {
      id: true,
      classes: { select: { id: true, section: true } },
      subjects: { select: { id: true, name: true, subject_code: true } },
      exams: {
        select: {
          id: true,
          academic_year: true,
          semester: true,
          exam_types: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

interface ExamMarkRow {
  id: number;
  marks_obtained: unknown;
  max_marks: unknown;
  is_absent: boolean;
  entered_at: Date;
  students: {
    id: number;
    student_id_no: string;
    soa_applications: { first_name: string; last_name: string | null } | null;
    users: { email: string };
  };
  exam_subject_mapping: {
    id: number;
    classes: { id: number; section: string };
    subjects: { id: number; name: string; subject_code: string };
    exams: {
      id: number;
      academic_year: string;
      semester: number;
      exam_types: { id: number; name: string };
    };
  };
}

function resolveStudentName(student: ExamMarkRow['students']): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

function toResponse(row: ExamMarkRow) {
  return {
    id: row.id,
    marks_obtained: row.marks_obtained,
    max_marks: row.max_marks,
    is_absent: row.is_absent,
    entered_at: row.entered_at,
    student: {
      id: row.students.id,
      student_id_no: row.students.student_id_no,
      name: resolveStudentName(row.students),
    },
    exam_subject_mapping_id: row.exam_subject_mapping.id,
    class: row.exam_subject_mapping.classes,
    subject: row.exam_subject_mapping.subjects,
    exam: {
      id: row.exam_subject_mapping.exams.id,
      type: row.exam_subject_mapping.exams.exam_types.name,
      academic_year: row.exam_subject_mapping.exams.academic_year,
      semester: row.exam_subject_mapping.exams.semester,
    },
  };
}

@Injectable()
export class ExamMarksService {
  private readonly logger = new Logger(ExamMarksService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /me/exams/:exam_subject_mapping_id/marks (Faculty only).
   * Bulk-enters marks for a whole class+subject's exam in one call.
   * Marks are entered once per exam_subject_mapping_id — a second
   * full-batch attempt is blocked entirely (409), with no correction path;
   * a mistaken entry has no PATCH/DELETE here by design (see the endpoint's
   * documented Known Limitations — a correction path would need COE/HoD
   * co-sign given the academic-integrity implications, which is out of
   * scope for this endpoint).
   */
  async enterMarks(
    examSubjectMappingId: number,
    dto: EnterExamMarksDto,
    userId: number,
  ) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mapping = await this.prisma.exam_subject_mapping.findUnique({
      where: { id: examSubjectMappingId },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Exam subject mapping not found',
        errorCode: 'MAPPING_NOT_FOUND',
      });
    }

    await this.assertMappedToTeach(
      faculty.id,
      mapping.subject_id,
      mapping.class_id,
    );

    await this.assertMarksEntryNotLocked(mapping.exam_id, mapping.class_id);

    const studentIds = dto.entries.map((e) => e.student_id);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('Duplicate student_id values in entries');
    }

    const invalid = dto.entries.filter(
      (e) =>
        !e.is_absent &&
        (e.marks_obtained === undefined ||
          e.marks_obtained < 0 ||
          e.marks_obtained > dto.max_marks),
    );
    if (invalid.length > 0) {
      throw new UnprocessableEntityException({
        message:
          'marks_obtained is required and must be between 0 and max_marks for every present student',
        errorCode: 'MARKS_OUT_OF_RANGE',
      });
    }

    const students = await this.prisma.students.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, class_id: true },
    });
    const inClassIds = new Set(
      students.filter((s) => s.class_id === mapping.class_id).map((s) => s.id),
    );
    const notInClassIds = studentIds.filter((id) => !inClassIds.has(id));
    if (notInClassIds.length > 0) {
      throw new UnprocessableEntityException({
        message: `Student(s) do not belong to this class: ${notInClassIds.join(', ')}`,
        errorCode: 'STUDENT_NOT_IN_CLASS',
      });
    }

    const alreadyEntered = await this.prisma.exam_marks.findFirst({
      where: { exam_subject_mapping_id: examSubjectMappingId },
    });
    if (alreadyEntered) {
      throw new ConflictException({
        message: 'Marks have already been entered for this exam and subject',
        errorCode: 'MARKS_ALREADY_ENTERED',
      });
    }

    const created = await this.prisma.$transaction(
      dto.entries.map((e) =>
        this.prisma.exam_marks.create({
          data: {
            exam_subject_mapping_id: examSubjectMappingId,
            student_id: e.student_id,
            marks_obtained: e.is_absent ? null : e.marks_obtained,
            is_absent: e.is_absent ?? false,
            max_marks: dto.max_marks,
            entered_by_faculty_id: faculty.id,
          },
          select: { id: true },
        }),
      ),
    );

    this.logger.log(
      `Exam marks entered: mapping=${examSubjectMappingId} faculty=${faculty.id} count=${created.length}`,
    );

    return {
      exam_subject_mapping_id: examSubjectMappingId,
      entered: created.length,
    };
  }

  /** GET /me/exam-marks (Faculty only — own-entered records). */
  async findAll(query: ListExamMarksQueryDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const where = {
      entered_by_faculty_id: faculty.id,
      exam_subject_mapping_id: query.exam_subject_mapping_id,
      student_id: query.student_id,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.exam_marks.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { id: 'desc' },
        select: EXAM_MARK_SELECT,
      }),
      this.prisma.exam_marks.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  /** GET /me/exam-marks/:id (Faculty only — own-entered record). */
  async findOne(id: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mark = await this.prisma.exam_marks.findUnique({
      where: { id },
      select: { ...EXAM_MARK_SELECT, entered_by_faculty_id: true },
    });
    if (!mark) {
      throw new NotFoundException('Exam mark not found');
    }
    if (mark.entered_by_faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only view marks you entered');
    }

    return toResponse(mark);
  }

  /**
   * PATCH /me/exam-marks/:id (Faculty only — the faculty who entered it).
   * Corrects a single wrongly-entered mark. Re-checks the [0, max_marks]
   * range against the row's own stored max_marks (unchanged by this call).
   */
  async update(id: number, dto: UpdateExamMarkDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const existing = await this.prisma.exam_marks.findUnique({
      where: { id },
      include: { exam_subject_mapping: true },
    });
    if (!existing) {
      throw new NotFoundException('Exam mark not found');
    }
    if (existing.entered_by_faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only correct marks you entered');
    }

    if (dto.marks_obtained === undefined && dto.is_absent === undefined) {
      throw new BadRequestException(
        'At least one of marks_obtained or is_absent must be provided',
      );
    }

    await this.assertMarksEntryNotLocked(
      existing.exam_subject_mapping.exam_id,
      existing.exam_subject_mapping.class_id,
    );

    const isAbsent = dto.is_absent ?? existing.is_absent;

    if (!isAbsent) {
      const marksObtained =
        dto.marks_obtained ??
        (existing.marks_obtained !== null
          ? Number(existing.marks_obtained)
          : undefined);

      if (marksObtained === undefined || marksObtained > Number(existing.max_marks)) {
        throw new UnprocessableEntityException({
          message: 'marks_obtained must be between 0 and max_marks',
          errorCode: 'MARKS_OUT_OF_RANGE',
        });
      }
    }

    const mark = await this.prisma.exam_marks.update({
      where: { id },
      data: {
        is_absent: isAbsent,
        marks_obtained: isAbsent ? null : dto.marks_obtained,
      },
      select: EXAM_MARK_SELECT,
    });

    this.logger.log(`Exam mark corrected: id=${id} faculty=${faculty.id}`);
    return toResponse(mark);
  }

  /**
   * POST /me/exam-marks/validate (Faculty only).
   * Stateless completeness check only — per explicit direction, this
   * reports whether every student in the class has an entry; it persists
   * nothing (schema has no validated/locked column to persist it in).
   */
  async validate(dto: ValidateExamMarksDto, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const mapping = await this.prisma.exam_subject_mapping.findUnique({
      where: { id: dto.exam_subject_mapping_id },
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Exam subject mapping not found',
        errorCode: 'MAPPING_NOT_FOUND',
      });
    }

    await this.assertMappedToTeach(
      faculty.id,
      mapping.subject_id,
      mapping.class_id,
    );

    const roster = await this.prisma.students.findMany({
      where: { class_id: mapping.class_id },
      select: { id: true },
    });

    const entries = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping_id: dto.exam_subject_mapping_id },
      select: { student_id: true, marks_obtained: true },
    });
    const enteredStudentIds = new Set(
      entries.filter((e) => e.marks_obtained !== null).map((e) => e.student_id),
    );

    const missingStudentIds = roster
      .map((s) => s.id)
      .filter((id) => !enteredStudentIds.has(id));

    return {
      exam_subject_mapping_id: dto.exam_subject_mapping_id,
      total_students: roster.length,
      entered: enteredStudentIds.size,
      validated: missingStudentIds.length === 0,
      missing_student_ids: missingStudentIds,
    };
  }

  /**
   * COE can lock marks entry for a whole exam+department combo (via
   * marks-entry-locks) to freeze it ahead of publishing. Resolves the
   * department from the class, since exam_subject_mapping only carries
   * class_id, not department_id directly.
   */
  private async assertMarksEntryNotLocked(examId: number, classId: number) {
    const classRecord = await this.prisma.classes.findUnique({
      where: { id: classId },
      select: { department_id: true },
    });
    if (!classRecord) return;

    const lock = await this.prisma.marks_entry_locks.findUnique({
      where: {
        exam_id_department_id: {
          exam_id: examId,
          department_id: classRecord.department_id,
        },
      },
    });

    if (lock?.is_locked) {
      throw new ConflictException({
        message: 'Marks entry is locked for this exam and department.',
        errorCode: 'MARKS_ENTRY_LOCKED',
      });
    }
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

  /**
   * exam_subject_mapping has no faculty_id of its own — ownership is
   * derived from faculty_subject_class_mapping, same as every other
   * Faculty-write in this codebase.
   */
  private async assertMappedToTeach(
    facultyId: number,
    subjectId: number,
    classId: number,
  ) {
    const mapping = await this.prisma.faculty_subject_class_mapping.findFirst({
      where: {
        faculty_id: facultyId,
        subject_id: subjectId,
        class_id: classId,
      },
    });
    if (!mapping) {
      throw new ForbiddenException({
        message: 'You are not assigned to teach this subject for this class',
        errorCode: 'NOT_MAPPED_TO_TEACH',
      });
    }
  }
}
