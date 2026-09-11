import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListArrearsQueryDto } from './dto/list-arrears-query.dto';
import { ScheduleSupplementaryDto } from './dto/schedule-supplementary.dto';

const STUDENT_SELECT = {
  id: true,
  register_no: true,
  student_id_no: true,
  roll_no: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  classes: {
    select: {
      current_semester: true,
      department_id: true,
      departments: { select: { code: true, name: true } },
      batches: { select: { start_year: true, end_year: true } },
    },
  },
} as const;

function studentName(s: {
  soa_applications: { first_name: string; last_name: string | null } | null;
}): string | null {
  if (!s.soa_applications) return null;
  return (
    [s.soa_applications.first_name, s.soa_applications.last_name]
      .filter(Boolean)
      .join(' ') || null
  );
}

interface Attempt {
  examId: number;
  category: string;
  total: number | null;
  isPass: boolean | null;
  enteredAt: Date;
  classId: number;
  subjectId: number;
  subjectCode: string;
  subjectName: string;
}

/**
 * Real, cumulative arrear computation reused across the whole student body —
 * same combined external+internal marks join and pass-mark rule as
 * student-exam-record.service.ts's per-student `standingArrears`, just run
 * once for everyone instead of one student at a time. "Standing arrear" =
 * a subject whose LATEST official (non-internal) attempt is a fail.
 */
@Injectable()
export class ArrearsService {
  constructor(private readonly prisma: PrismaService) {}

  private async computeBoard() {
    const [
      rules,
      regulations,
      activeStudents,
      officialMarks,
      internalMappings,
    ] = await Promise.all([
      this.prisma.exam_pass_rules_settings.findFirst(),
      this.prisma.regulations.findMany({
        select: { intake_start_year: true, attendance_threshold_pct: true },
      }),
      this.prisma.students.findMany({
        where: { status: 'active' },
        select: STUDENT_SELECT,
      }),
      this.prisma.exam_marks.findMany({
        where: {
          exam_subject_mapping: {
            exams: { exam_types: { category: { not: 'internal' } } },
          },
        },
        select: {
          student_id: true,
          marks_obtained: true,
          is_absent: true,
          entered_at: true,
          exam_subject_mapping: {
            select: {
              class_id: true,
              subject_id: true,
              subjects: { select: { subject_code: true, name: true } },
              exams: {
                select: {
                  id: true,
                  academic_year: true,
                  semester: true,
                  exam_category: true,
                },
              },
            },
          },
        },
        orderBy: { entered_at: 'asc' },
      }),
      this.prisma.exam_subject_mapping.findMany({
        where: { exams: { exam_types: { category: 'internal' } } },
        select: {
          id: true,
          class_id: true,
          subject_id: true,
          exams: { select: { academic_year: true, semester: true } },
        },
      }),
    ]);

    const passMark = rules ? Number(rules.pass_mark_total) : 50;
    const regulationByStartYear = new Map(
      regulations.map((r) => [
        r.intake_start_year,
        Number(r.attendance_threshold_pct),
      ]),
    );

    const internalMapByKey = new Map<string, number>();
    for (const im of internalMappings) {
      internalMapByKey.set(
        `${im.class_id}|${im.subject_id}|${im.exams.academic_year}|${im.exams.semester}`,
        im.id,
      );
    }
    const internalMappingIds = [...new Set(internalMappings.map((m) => m.id))];
    const internalMarks = internalMappingIds.length
      ? await this.prisma.exam_marks.findMany({
          where: { exam_subject_mapping_id: { in: internalMappingIds } },
          select: {
            exam_subject_mapping_id: true,
            student_id: true,
            marks_obtained: true,
          },
        })
      : [];
    const internalMarkByKey = new Map(
      internalMarks.map((m) => [
        `${m.exam_subject_mapping_id}|${m.student_id}`,
        m.marks_obtained,
      ]),
    );

    // (student_id, subject_id) -> every official attempt ever recorded, oldest first.
    const bySubjectStudent = new Map<string, Attempt[]>();
    for (const m of officialMarks) {
      const mapping = m.exam_subject_mapping;
      const key = `${mapping.class_id}|${mapping.subject_id}|${mapping.exams.academic_year}|${mapping.exams.semester}`;
      const internalMappingId = internalMapByKey.get(key);
      let total: number | null =
        m.marks_obtained != null ? Number(m.marks_obtained) : null;
      if (!m.is_absent && internalMappingId != null) {
        const internalScore = internalMarkByKey.get(
          `${internalMappingId}|${m.student_id}`,
        );
        if (internalScore != null && total != null)
          total += Number(internalScore);
      }
      const isPass = m.is_absent
        ? false
        : total != null
          ? total >= passMark
          : null;
      const groupKey = `${m.student_id}|${mapping.subject_id}`;
      const list = bySubjectStudent.get(groupKey) ?? [];
      list.push({
        examId: mapping.exams.id,
        category: mapping.exams.exam_category,
        total,
        isPass,
        enteredAt: m.entered_at,
        classId: mapping.class_id,
        subjectId: mapping.subject_id,
        subjectCode: mapping.subjects.subject_code,
        subjectName: mapping.subjects.name,
      });
      bySubjectStudent.set(groupKey, list);
    }

    // Per-student standing arrears — every subject whose latest attempt is still a fail.
    const standingByStudent = new Map<
      number,
      {
        subjectId: number;
        classId: number;
        subjectCode: string;
        subjectName: string;
        standingSince: Date;
        attempts: number;
      }[]
    >();
    const everArrearStudentIds = new Set<number>();
    for (const [key, list] of bySubjectStudent) {
      if (list.some((a) => a.isPass === false))
        everArrearStudentIds.add(Number(key.split('|')[0]));
      const sorted = [...list].sort(
        (a, b) => a.enteredAt.getTime() - b.enteredAt.getTime(),
      );
      const latest = sorted[sorted.length - 1];
      if (latest.isPass !== false) continue;
      const studentId = Number(key.split('|')[0]);
      const entry = {
        subjectId: latest.subjectId,
        classId: latest.classId,
        subjectCode: latest.subjectCode,
        subjectName: latest.subjectName,
        standingSince: sorted[0].enteredAt,
        attempts: sorted.length,
      };
      const arr = standingByStudent.get(studentId) ?? [];
      arr.push(entry);
      standingByStudent.set(studentId, arr);
    }

    // "Last cycle" = the most recently active arrear/supplementary exam (by the latest mark entered against it).
    const cycleLastSeen = new Map<
      number,
      { category: string; lastSeen: Date }
    >();
    for (const m of officialMarks) {
      const exam = m.exam_subject_mapping.exams;
      if (exam.exam_category === 'regular') continue;
      const existing = cycleLastSeen.get(exam.id);
      if (!existing || m.entered_at > existing.lastSeen)
        cycleLastSeen.set(exam.id, {
          category: exam.exam_category,
          lastSeen: m.entered_at,
        });
    }
    const cyclesDesc = [...cycleLastSeen.entries()].sort(
      (a, b) => b[1].lastSeen.getTime() - a[1].lastSeen.getTime(),
    );
    const lastCycleExamId = cyclesDesc[0]?.[0] ?? null;
    const previousCycleExamId = cyclesDesc[1]?.[0] ?? null;

    function clearedIn(examId: number | null): Set<number> {
      const result = new Set<number>();
      if (examId == null) return result;
      for (const [key, list] of bySubjectStudent) {
        const sorted = [...list].sort(
          (a, b) => a.enteredAt.getTime() - b.enteredAt.getTime(),
        );
        const idx = sorted.findIndex((a) => a.examId === examId);
        if (
          idx > 0 &&
          sorted[idx].isPass === true &&
          sorted[idx - 1].isPass === false
        )
          result.add(Number(key.split('|')[0]));
      }
      return result;
    }
    const clearedLastCycle = clearedIn(lastCycleExamId);
    const clearedPreviousCycle = clearedIn(previousCycleExamId);

    // Real, arrear-specific registrations — a student who filed one is "Registered", full stop.
    const arrearStudentIds = [...everArrearStudentIds];
    const registrations = arrearStudentIds.length
      ? await this.prisma.exam_registrations.findMany({
          where: {
            student_id: { in: arrearStudentIds },
            exams: { exam_category: { in: ['arrear', 'supplementary'] } },
          },
          select: { student_id: true },
        })
      : [];
    const registeredIds = new Set(registrations.map((r) => r.student_id));

    // Real attendance-based debarment — same overall-attendance-vs-regulation-threshold
    // rule as student-exam-record.service.ts, applied here across the whole arrear
    // roster instead of one student. No "max attempts" cap exists anywhere in the
    // schema, so that is deliberately NOT used as an eligibility rule here.
    const attendanceRows = arrearStudentIds.length
      ? await this.prisma.attendance_records.findMany({
          where: { student_id: { in: arrearStudentIds }, is_published: true },
          select: { student_id: true, status: true },
        })
      : [];
    const attendanceByStudent = new Map<
      number,
      { total: number; attended: number }
    >();
    for (const r of attendanceRows) {
      const e = attendanceByStudent.get(r.student_id) ?? {
        total: 0,
        attended: 0,
      };
      e.total += 1;
      if (r.status !== 'absent') e.attended += 1;
      attendanceByStudent.set(r.student_id, e);
    }

    return {
      passMark,
      activeStudents,
      standingByStudent,
      everArrearStudentIds,
      registeredIds,
      clearedLastCycle,
      clearedPreviousCycle,
      attendanceByStudent,
      regulationByStartYear,
    };
  }

  private studentEligibilityThreshold(
    startYear: number | undefined,
    regulationByStartYear: Map<number, number>,
  ): number {
    if (startYear == null) return 75;
    return regulationByStartYear.get(startYear) ?? 75;
  }

  /** GET /arrears/overview — the real KPI tiles + roster backing the Supplementary & Arrear page. */
  async getOverview(query: ListArrearsQueryDto) {
    const board = await this.computeBoard();
    const studentById = new Map(board.activeStudents.map((s) => [s.id, s]));

    const rows = [...board.everArrearStudentIds]
      .map((id) => {
        const student = studentById.get(id);
        if (!student) return null;
        const standing = (board.standingByStudent.get(id) ?? []).sort(
          (a, b) => a.standingSince.getTime() - b.standingSince.getTime(),
        );
        const oldest = standing[0] ?? null;

        const registered = board.registeredIds.has(id);
        const cleared = standing.length === 0;
        const att = board.attendanceByStudent.get(id);
        const attPct =
          att && att.total > 0
            ? Math.round((att.attended / att.total) * 1000) / 10
            : null;
        const threshold = this.studentEligibilityThreshold(
          student.classes?.batches?.start_year,
          board.regulationByStartYear,
        );
        const notEligible =
          !registered && !cleared && attPct != null && attPct < threshold;

        const status: 'registered' | 'cleared' | 'not_eligible' | 'pending' =
          registered
            ? 'registered'
            : cleared
              ? 'cleared'
              : notEligible
                ? 'not_eligible'
                : 'pending';

        return {
          id: student.id,
          register_no: student.register_no ?? student.student_id_no,
          name: studentName(student),
          department: student.classes?.departments ?? null,
          year: student.classes?.current_semester
            ? Math.ceil(student.classes.current_semester / 2)
            : null,
          standing_arrears_count: standing.length,
          oldest_arrear: oldest
            ? {
                subject_code: oldest.subjectCode,
                subject_name: oldest.subjectName,
                standing_since: oldest.standingSince.toISOString().slice(0, 10),
                attempts: oldest.attempts,
              }
            : null,
          status,
        };
      })
      .filter((r): r is NonNullable<typeof r> => r != null)
      .filter(
        (r) =>
          query.department_id == null ||
          studentById.get(r.id)?.classes?.department_id === query.department_id,
      )
      .filter((r) => query.year == null || r.year === query.year)
      .filter((r) => query.status == null || r.status === query.status)
      .filter((r) => {
        if (!query.search?.trim()) return true;
        const q = query.search.trim().toLowerCase();
        return [r.register_no, r.name, r.oldest_arrear?.subject_code]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => b.standing_arrears_count - a.standing_arrears_count);

    const totalActive = board.activeStudents.length;
    const standingArrearsTotal = [...board.standingByStudent.values()].reduce(
      (sum, list) => sum + list.length,
      0,
    );
    const studentsWithStanding = board.standingByStudent.size;

    return {
      stats: {
        arrear_students: board.everArrearStudentIds.size,
        arrear_students_pct_of_strength:
          totalActive > 0
            ? Math.round(
                (board.everArrearStudentIds.size / totalActive) * 1000,
              ) / 10
            : null,
        standing_arrears_total: standingArrearsTotal,
        standing_arrears_avg_per_student:
          studentsWithStanding > 0
            ? Math.round((standingArrearsTotal / studentsWithStanding) * 10) /
              10
            : null,
        registered_for_arrear: [...board.registeredIds].filter((id) =>
          board.everArrearStudentIds.has(id),
        ).length,
        registered_pct_of_eligible:
          studentsWithStanding > 0
            ? Math.round(
                ([...board.registeredIds].filter((id) =>
                  board.standingByStudent.has(id),
                ).length /
                  studentsWithStanding) *
                  1000,
              ) / 10
            : null,
        cleared_last_cycle: board.clearedLastCycle.size,
        cleared_last_cycle_delta:
          board.clearedLastCycle.size - board.clearedPreviousCycle.size,
      },
      students: rows,
    };
  }

  /** GET /arrears/students/:id/history — every arrear subject for one student, not just their oldest. */
  async getStudentHistory(studentId: number) {
    const board = await this.computeBoard();
    const student = board.activeStudents.find((s) => s.id === studentId);
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found or not active.',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    const standing = (board.standingByStudent.get(studentId) ?? [])
      .sort((a, b) => a.standingSince.getTime() - b.standingSince.getTime())
      .map((s) => ({
        subject_code: s.subjectCode,
        subject_name: s.subjectName,
        standing_since: s.standingSince.toISOString().slice(0, 10),
        attempts: s.attempts,
      }));

    return {
      student: {
        id: student.id,
        register_no: student.register_no ?? student.student_id_no,
        name: studentName(student),
        department: student.classes?.departments ?? null,
        year: student.classes?.current_semester
          ? Math.ceil(student.classes.current_semester / 2)
          : null,
      },
      standing_arrears: standing,
      registered: board.registeredIds.has(studentId),
    };
  }

  /**
   * POST /arrears/supplementary — creates one real `exams` row (category
   * 'supplementary') plus one `exam_subject_mapping` per currently-standing
   * arrear (class_id, subject_id) pair, so registration can genuinely open
   * against real courses. `exams.batch_id`/`semester` are NOT NULL columns
   * but exam_subject_mapping.class_id is the field that actually targets
   * each student's real class — independent of the parent exam's batch_id —
   * so those two are set to whichever batch/semester most of the affected
   * classes belong to, as a nominal label, not a hard scope restriction.
   */
  async scheduleSupplementary(
    dto: ScheduleSupplementaryDto,
    createdByUserId: number,
  ) {
    const board = await this.computeBoard();
    const pairs = new Map<string, { classId: number; subjectId: number }>();
    for (const list of board.standingByStudent.values()) {
      for (const item of list)
        pairs.set(`${item.classId}|${item.subjectId}`, {
          classId: item.classId,
          subjectId: item.subjectId,
        });
    }
    if (pairs.size === 0) {
      throw new UnprocessableEntityException({
        message:
          'There are no standing arrears to schedule a supplementary sitting for.',
        errorCode: 'NO_STANDING_ARREARS',
      });
    }

    let examType = await this.prisma.exam_types.findFirst({
      where: { code: 'SUPP' },
    });
    if (!examType) {
      examType = await this.prisma.exam_types.create({
        data: {
          name: 'Supplementary Examination',
          category: 'external',
          code: 'SUPP',
          is_university: true,
        },
      });
    }

    const classIds = [...new Set([...pairs.values()].map((p) => p.classId))];
    const classes = await this.prisma.classes.findMany({
      where: { id: { in: classIds } },
      select: {
        id: true,
        batch_id: true,
        current_semester: true,
        batches: { select: { start_year: true } },
      },
    });

    const batchCounts = new Map<number, number>();
    const semesterCounts = new Map<number, number>();
    for (const c of classes) {
      batchCounts.set(c.batch_id, (batchCounts.get(c.batch_id) ?? 0) + 1);
      const semester = c.current_semester ?? 1;
      semesterCounts.set(semester, (semesterCounts.get(semester) ?? 0) + 1);
    }
    const modeBatchId =
      [...batchCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ??
      classes[0]?.batch_id;
    const modeSemester =
      [...semesterCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 1;
    const modeStartYear = classes.find((c) => c.batch_id === modeBatchId)
      ?.batches?.start_year;
    const startYear = new Date(dto.starts_on);
    const academicYear =
      modeStartYear != null
        ? `${modeStartYear}-${modeStartYear + 1}`
        : `${startYear.getUTCFullYear()}-${startYear.getUTCFullYear() + 1}`;

    const exam = await this.prisma.exams.create({
      data: {
        title: dto.title,
        exam_type_id: examType.id,
        batch_id: modeBatchId,
        academic_year: academicYear,
        semester: modeSemester,
        exam_category: 'supplementary',
        start_date: new Date(dto.starts_on),
        end_date: new Date(dto.ends_on),
        registration_opens_at: new Date(),
        registration_closes_at: new Date(dto.ends_on),
        fee_amount: dto.fee_per_course,
        created_by_user_id: createdByUserId,
      },
    });

    await this.prisma.exam_subject_mapping.createMany({
      data: [...pairs.values()].map((p) => ({
        exam_id: exam.id,
        class_id: p.classId,
        subject_id: p.subjectId,
      })),
      skipDuplicates: true,
    });

    return { ...exam, courses_opened: pairs.size };
  }
}
