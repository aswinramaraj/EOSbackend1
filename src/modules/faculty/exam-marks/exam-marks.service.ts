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
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { EnterExamMarksDto } from './dto/enter-exam-marks.dto';
import { UpdateExamMarkDto } from './dto/update-exam-mark.dto';
import { ListExamMarksQueryDto } from './dto/list-exam-marks-query.dto';
import { ValidateExamMarksDto } from './dto/validate-exam-marks.dto';

const EXAM_MARK_SELECT = {
  id: true,
  marks_obtained: true,
  max_marks: true,
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
          exam_types: { select: { id: true, name: true, category: true } },
        },
      },
    },
  },
} as const;

interface ExamMarkRow {
  id: number;
  marks_obtained: unknown;
  max_marks: unknown;
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
      exam_types: { id: number; name: string; category: 'internal' | 'external' };
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
    // Decimal fields — see the roster method's comment for why these must
    // be converted with Number() before ever reaching JSON.
    marks_obtained: Number(row.marks_obtained),
    max_marks: Number(row.max_marks),
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
      category: row.exam_subject_mapping.exams.exam_types.category,
      academic_year: row.exam_subject_mapping.exams.academic_year,
      semester: row.exam_subject_mapping.exams.semester,
    },
  };
}

@Injectable()
export class ExamMarksService {
  private readonly logger = new Logger(ExamMarksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * POST /me/exams/:exam_subject_mapping_id/marks (Faculty only).
   * Bulk-enters marks for a class+subject's exam. A student who already
   * has a row for this mapping is silently skipped rather than blocking
   * the whole request — this is what lets a faculty top up the roster
   * later for students missed the first time around, while the DB's own
   * @@unique([exam_subject_mapping_id, student_id]) still makes a true
   * double-entry for the same student impossible. Correcting an
   * already-entered value still has no path here by design (see
   * PATCH /me/exam-marks/:id instead) — this endpoint only ever fills in
   * students with no row yet.
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
    await this.assertInternalExam(examSubjectMappingId);

    const studentIds = dto.entries.map((e) => e.student_id);
    if (new Set(studentIds).size !== studentIds.length) {
      throw new BadRequestException('Duplicate student_id values in entries');
    }

    const existing = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping_id: examSubjectMappingId },
      select: { student_id: true, max_marks: true },
    });

    // max_marks is fixed to whatever the FIRST entry for this mapping
    // established — every later top-up must share it, so marks stay
    // comparable across the whole class (Subject Records' grade
    // distribution and Class Result's CGPA both assume one max_marks per
    // mapping). The caller's own dto.max_marks is only used to seed it.
    const effectiveMaxMarks =
      existing.length > 0 ? Number(existing[0].max_marks) : dto.max_marks;

    const outOfRange = dto.entries.filter(
      (e) => e.marks_obtained < 0 || e.marks_obtained > effectiveMaxMarks,
    );
    if (outOfRange.length > 0) {
      throw new UnprocessableEntityException({
        message: 'marks_obtained must be between 0 and max_marks',
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

    const alreadyEnteredIds = new Set(existing.map((e) => e.student_id));
    const newEntries = dto.entries.filter(
      (e) => !alreadyEnteredIds.has(e.student_id),
    );
    if (newEntries.length === 0) {
      throw new ConflictException({
        message: 'Marks have already been entered for every submitted student',
        errorCode: 'MARKS_ALREADY_ENTERED',
      });
    }

    const created = await this.prisma.$transaction(
      newEntries.map((e) =>
        this.prisma.exam_marks.create({
          data: {
            exam_subject_mapping_id: examSubjectMappingId,
            student_id: e.student_id,
            marks_obtained: e.marks_obtained,
            max_marks: effectiveMaxMarks,
            entered_by_faculty_id: faculty.id,
          },
          select: { id: true },
        }),
      ),
    );

    this.logger.log(
      `Exam marks entered: mapping=${examSubjectMappingId} faculty=${faculty.id} count=${created.length} (skipped ${dto.entries.length - newEntries.length} already-entered)`,
    );

    await this.notifyMarksPosted(
      examSubjectMappingId,
      faculty.id,
      newEntries.map((e) => e.student_id),
    );

    return {
      exam_subject_mapping_id: examSubjectMappingId,
      entered: created.length,
      skipped_already_entered: dto.entries.length - newEntries.length,
    };
  }

  /**
   * Notifies every student who just got a mark entered. Never throws - a
   * failure here must not roll back or fail marks entry, which has already
   * committed by the time this runs (same convention as
   * results.service.ts's notifyResultsPublished).
   */
  private async notifyMarksPosted(
    examSubjectMappingId: number,
    facultyId: number,
    studentIds: number[],
  ): Promise<void> {
    if (studentIds.length === 0) return;
    try {
      const [mapping, faculty, students] = await Promise.all([
        this.prisma.exam_subject_mapping.findUnique({
          where: { id: examSubjectMappingId },
          select: {
            classes: { select: { section: true } },
            subjects: { select: { name: true } },
            exams: { select: { exam_types: { select: { name: true } } } },
          },
        }),
        this.prisma.faculty.findUnique({
          where: { id: facultyId },
          select: { first_name: true, last_name: true },
        }),
        this.prisma.students.findMany({
          where: { id: { in: studentIds } },
          select: { user_id: true },
        }),
      ]);
      if (!mapping) return;

      const facultyName = faculty
        ? `${faculty.first_name} ${faculty.last_name}`
        : 'Your faculty';
      const message = `${facultyName} posted the ${mapping.exams.exam_types.name} marks for ${mapping.subjects.name} · Class ${mapping.classes.section}.`;

      for (const s of students) {
        await this.notifications.notify({
          user_id: s.user_id,
          title: 'Exam marks posted',
          message,
          type: 'cia_marks_posted',
          related_entity_type: 'exam_subject_mapping',
          related_entity_id: examSubjectMappingId,
        });
      }
    } catch (err) {
      this.logger.error(
        `Failed to notify students of posted marks for mapping ${examSubjectMappingId}`,
        err,
      );
    }
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
    });
    if (!existing) {
      throw new NotFoundException('Exam mark not found');
    }
    if (existing.entered_by_faculty_id !== faculty.id) {
      throw new ForbiddenException('You may only correct marks you entered');
    }
    await this.assertInternalExam(existing.exam_subject_mapping_id);

    if (dto.marks_obtained > Number(existing.max_marks)) {
      throw new UnprocessableEntityException({
        message: 'marks_obtained must be between 0 and max_marks',
        errorCode: 'MARKS_OUT_OF_RANGE',
      });
    }

    const mark = await this.prisma.exam_marks.update({
      where: { id },
      data: { marks_obtained: dto.marks_obtained },
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
   * GET /me/exam-marks/roster/:exam_subject_mapping_id (Faculty only).
   * Full class roster for the mapping's class, each student joined against
   * their own exam_marks row if one exists yet (id + marks_obtained, else
   * null) — this is what the CIA Marks entry screen renders and edits.
   * `locked` is only true once EVERY student has a row — enterMarks() can
   * always add rows for students who don't have one yet (a partial roster
   * is never locked), so the frontend can keep filling in the gaps; only a
   * fully-entered mapping has nothing left to bulk-add, leaving
   * PATCH /me/exam-marks/:id as the only way to change a value.
   */
  async getRoster(examSubjectMappingId: number, userId: number) {
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

    const roster = await this.prisma.students.findMany({
      where: { class_id: mapping.class_id },
      orderBy: { roll_no: 'asc' },
      select: {
        id: true,
        student_id_no: true,
        roll_no: true,
        soa_applications: { select: { first_name: true, last_name: true } },
        users: { select: { email: true } },
      },
    });

    const marks = await this.prisma.exam_marks.findMany({
      where: { exam_subject_mapping_id: examSubjectMappingId },
      select: { id: true, student_id: true, marks_obtained: true, max_marks: true },
    });
    const markByStudentId = new Map(marks.map((m) => [m.student_id, m]));

    return {
      exam_subject_mapping_id: examSubjectMappingId,
      locked: marks.length > 0 && marks.length >= roster.length,
      // max_marks/marks_obtained are Prisma Decimal fields — left unconverted
      // they serialize to JSON as strings (e.g. "100.00"), which then fails
      // the frontend's re-POST against EnterExamMarksDto's @IsNumber/@Min
      // checks ("max_marks must be a number... must not be less than 1")
      // since a string never satisfies @IsNumber. Number(...) here matches
      // the same conversion already done elsewhere in this file (e.g.
      // enterMarks' effectiveMaxMarks, updateMark's range check).
      max_marks: marks.length > 0 ? Number(marks[0].max_marks) : null,
      students: roster.map((student) => {
        const mark = markByStudentId.get(student.id);
        return {
          student_id: student.id,
          roll_no: student.roll_no ?? student.student_id_no,
          name: resolveStudentName(student),
          mark_id: mark?.id ?? null,
          marks_obtained: mark?.marks_obtained !== undefined && mark?.marks_obtained !== null ? Number(mark.marks_obtained) : null,
        };
      }),
    };
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

  /**
   * Faculty may only enter/correct marks for internal exams (CIA1/2/3) —
   * external (University End Semester) results come from COE's own
   * pipeline. The frontend already hides the edit controls for an external
   * exam; this is the server-side backstop against a direct API call.
   */
  private async assertInternalExam(
    examSubjectMappingId: number,
  ): Promise<void> {
    const mapping = await this.prisma.exam_subject_mapping.findUnique({
      where: { id: examSubjectMappingId },
      select: { exams: { select: { exam_types: { select: { category: true } } } } },
    });
    if (mapping?.exams.exam_types.category !== 'internal') {
      throw new ForbiddenException({
        message:
          'This is a university exam — marks are entered by the Controller of Examinations, not by faculty.',
        errorCode: 'EXTERNAL_EXAM_NOT_EDITABLE',
      });
    }
  }
}
