import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

// Anna University-style absolute grading, matching the frontend's fixed
// grade labels (O, A+, A, B+, B, RA) exactly.
const GRADE_BANDS: { grade: string; min: number }[] = [
  { grade: 'O', min: 91 },
  { grade: 'A+', min: 81 },
  { grade: 'A', min: 71 },
  { grade: 'B+', min: 61 },
  { grade: 'B', min: 50 },
  { grade: 'RA', min: 0 },
];

function gradeForPercentage(percentage: number): string {
  const band = GRADE_BANDS.find((b) => percentage >= b.min);
  return band ? band.grade : 'RA';
}

function resolveStudentName(student: {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

const MAPPING_SELECT = {
  id: true,
  is_published: true,
  published_at: true,
  classes: {
    select: {
      id: true,
      section: true,
      courses: { select: { code: true } },
      batches: { select: { name: true } },
    },
  },
  subjects: { select: { id: true, name: true, subject_code: true } },
  exams: {
    select: {
      id: true,
      academic_year: true,
      semester: true,
      exam_types: { select: { id: true, name: true, category: true } },
    },
  },
} as const;

type MappingRow = {
  id: number;
  is_published: boolean;
  published_at: Date | null;
  classes: {
    id: number;
    section: string;
    courses: { code: string };
    batches: { name: string };
  };
  subjects: { id: number; name: string; subject_code: string };
  exams: {
    id: number;
    academic_year: string;
    semester: number;
    exam_types: { id: number; name: string; category: 'internal' | 'external' };
  };
};

function classLabel(klass: MappingRow['classes']): string {
  return `${klass.courses.code}-${klass.section} (${klass.batches.name})`;
}

function toSummary(mapping: MappingRow, enteredCount: number) {
  return {
    exam_subject_mapping_id: mapping.id,
    class: { id: mapping.classes.id, label: classLabel(mapping.classes) },
    subject: mapping.subjects,
    exam: {
      id: mapping.exams.id,
      type: mapping.exams.exam_types.name,
      // internal (CIA1/2/3) marks are entered by faculty here; external
      // (University End Semester) marks come from COE's own results
      // pipeline — the frontend uses this to render that exam read-only.
      category: mapping.exams.exam_types.category,
      academic_year: mapping.exams.academic_year,
      semester: mapping.exams.semester,
    },
    is_published: mapping.is_published,
    published_at: mapping.published_at,
    entered_count: enteredCount,
  };
}

@Injectable()
export class SubjectRecordsService {
  private readonly logger = new Logger(SubjectRecordsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/subject-records (Faculty only).
   * Lists every class+subject exam mapping the calling faculty is assigned
   * to teach (via faculty_subject_class_mapping), across all exams — used to
   * populate the "Class & Subject" selector on the Subject Records screen.
   */
  async findMappings(userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);

    const taughtMappings = await this.prisma.faculty_subject_class_mapping.findMany(
      {
        where: { faculty_id: faculty.id },
        select: { subject_id: true, class_id: true },
      },
    );
    if (taughtMappings.length === 0) {
      return [];
    }

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: {
        OR: taughtMappings.map((m) => ({
          subject_id: m.subject_id,
          class_id: m.class_id,
        })),
      },
      orderBy: { id: 'desc' },
      select: MAPPING_SELECT,
    });

    const counts = await this.prisma.exam_marks.groupBy({
      by: ['exam_subject_mapping_id'],
      where: { exam_subject_mapping_id: { in: mappings.map((m) => m.id) } },
      _count: { _all: true },
    });
    const countByMapping = new Map(
      counts.map((c) => [c.exam_subject_mapping_id, c._count._all]),
    );

    return mappings.map((m) => toSummary(m, countByMapping.get(m.id) ?? 0));
  }

  /**
   * GET /me/subject-records/:exam_subject_mapping_id (Faculty only, mapped
   * to teach). Computes grade distribution and toppers live from exam_marks
   * — there is no stored letter-grade column, so grades are derived from
   * marks_obtained/max_marks using the standard Anna University absolute
   * grading bands.
   */
  async findOne(examSubjectMappingId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const mapping = await this.loadMapping(examSubjectMappingId);
    await this.assertMappedToTeach(
      faculty.id,
      mapping.subjects.id,
      mapping.classes.id,
    );

    const roster = await this.prisma.students.findMany({
      where: { class_id: mapping.classes.id },
      select: { id: true },
    });

    const marks = await this.prisma.exam_marks.findMany({
      where: {
        exam_subject_mapping_id: examSubjectMappingId,
        marks_obtained: { not: null },
      },
      select: {
        marks_obtained: true,
        max_marks: true,
        students: {
          select: {
            id: true,
            student_id_no: true,
            soa_applications: { select: { first_name: true, last_name: true } },
            users: { select: { email: true } },
          },
        },
      },
    });

    const scored = marks.map((m) => {
      const obtained = Number(m.marks_obtained);
      const max = Number(m.max_marks);
      const percentage = max > 0 ? (obtained / max) * 100 : 0;
      return {
        percentage,
        obtained,
        max,
        student: m.students,
      };
    });

    const distributionByGrade = new Map(GRADE_BANDS.map((b) => [b.grade, 0]));
    for (const row of scored) {
      const grade = gradeForPercentage(row.percentage);
      distributionByGrade.set(grade, (distributionByGrade.get(grade) ?? 0) + 1);
    }
    const grade_distribution = GRADE_BANDS.map((b) => ({
      grade: b.grade,
      count: distributionByGrade.get(b.grade) ?? 0,
    }));

    const toppers = [...scored]
      .sort((a, b) => b.percentage - a.percentage)
      .slice(0, 3)
      .map((row, index) => ({
        rank: index + 1,
        name: resolveStudentName(row.student),
        roll_no: row.student.student_id_no,
        score: Math.round(row.obtained * 100) / 100,
      }));

    return {
      ...toSummary(mapping, scored.length),
      total_students: roster.length,
      grade_distribution,
      toppers,
    };
  }

  /**
   * POST /me/subject-records/:exam_subject_mapping_id/publish (Faculty
   * only, mapped to teach). Marks the result as published to the class.
   * Requires at least one mark entered — publishing an empty result would
   * be meaningless. Idempotent: publishing an already-published mapping
   * just refreshes published_at.
   */
  async publish(examSubjectMappingId: number, userId: number) {
    const faculty = await this.resolveFacultyByUserId(userId);
    const mapping = await this.loadMapping(examSubjectMappingId);
    await this.assertMappedToTeach(
      faculty.id,
      mapping.subjects.id,
      mapping.classes.id,
    );
    if (mapping.exams.exam_types.category !== 'internal') {
      throw new ForbiddenException({
        message:
          'University exam results are published by the Controller of Examinations, not by faculty.',
        errorCode: 'EXTERNAL_EXAM_NOT_PUBLISHABLE',
      });
    }

    const enteredCount = await this.prisma.exam_marks.count({
      where: {
        exam_subject_mapping_id: examSubjectMappingId,
        marks_obtained: { not: null },
      },
    });
    if (enteredCount === 0) {
      throw new BadRequestException({
        message: 'Cannot publish a result with no marks entered',
        errorCode: 'NO_MARKS_ENTERED',
      });
    }

    const updated = await this.prisma.exam_subject_mapping.update({
      where: { id: examSubjectMappingId },
      data: { is_published: true, published_at: new Date() },
      select: MAPPING_SELECT,
    });

    this.logger.log(
      `Subject result published: mapping=${examSubjectMappingId} faculty=${faculty.id}`,
    );

    return toSummary(updated, enteredCount);
  }

  private async loadMapping(id: number): Promise<MappingRow> {
    const mapping = await this.prisma.exam_subject_mapping.findUnique({
      where: { id },
      select: MAPPING_SELECT,
    });
    if (!mapping) {
      throw new NotFoundException({
        message: 'Exam subject mapping not found',
        errorCode: 'MAPPING_NOT_FOUND',
      });
    }
    return mapping;
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
   * derived from faculty_subject_class_mapping, same as exam-marks.
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
