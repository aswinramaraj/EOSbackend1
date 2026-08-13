import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { FacultyAttendanceService } from 'src/modules/faculty/faculty-attendance/faculty-attendance.service';
import { HodReportsService } from '../hod-reports/hod-reports.service';

const ATTENDANCE_THRESHOLD_PERCENT = 75;
const CLASS_ATTENDANCE_HEALTHY_PERCENT = 90;

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];
function yearLabelForSemester(semester: number): string {
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}
function formatHHMM(value: Date): string {
  return `${pad2(value.getUTCHours())}:${pad2(value.getUTCMinutes())}`;
}

interface AttentionFlag {
  type: string;
  title: string;
  detail: string;
}

@Injectable()
export class HodDashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly facultyAttendanceService: FacultyAttendanceService,
    private readonly hodReportsService: HodReportsService,
  ) {}

  /** Resolves the caller's own faculty row + department — never trusts a client-supplied department_id. */
  private async resolveHod(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: {
        id: true,
        department_id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        designation: true,
      },
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

  /** GET /hod/dashboard?scope=today|term */
  async getSummary(userId: number, scope: 'today' | 'term' = 'today') {
    const { faculty, department } = await this.resolveHod(userId);

    const [
      studentAttendance,
      facultyAttendanceOverview,
      reportsSummary,
      placements,
      needsAttention,
      upNext,
      announcements,
    ] = await Promise.all([
      this.getStudentAttendance(department.id, scope),
      this.facultyAttendanceService.getOverview(department.id),
      this.hodReportsService.getSummary(userId),
      this.getPlacementsSummary(department.id),
      this.getNeedsAttention(department.id),
      this.getUpNext(faculty.id),
      this.getAnnouncements(department.id),
    ]);

    // "My department" below always reads as term-to-date (its own sub-label
    // says so unconditionally), independent of the Today/This term toggle
    // above — only fetched again when the toggle itself isn't already 'term'.
    const studentAttendanceTermToDate =
      scope === 'term'
        ? studentAttendance
        : await this.getStudentAttendance(department.id, 'term');

    const facultyOnRoll = facultyAttendanceOverview.rows.length;

    let facultyAttendance: {
      percentage: number;
      reported: number;
      on_roll: number;
      on_leave: number;
      on_duty: number;
    };
    if (scope === 'today') {
      facultyAttendance = {
        percentage: facultyAttendanceOverview.today.attendance_percentage,
        reported: facultyAttendanceOverview.rows.filter(
          (r) => r.today_status === 'full_day' || r.today_status === 'half_day',
        ).length,
        on_roll: facultyOnRoll,
        on_leave: facultyAttendanceOverview.rows.filter(
          (r) => r.today_status === 'on_leave',
        ).length,
        on_duty: facultyAttendanceOverview.rows.filter(
          (r) => r.today_status === 'on_duty',
        ).length,
      };
    } else {
      // Term-to-date, rolled up from each row's own life-to-date totals
      // (already computed by getOverview) — no extra query needed.
      let full = 0;
      let half = 0;
      let absent = 0;
      let onLeave = 0;
      let onDuty = 0;
      for (const r of facultyAttendanceOverview.rows) {
        full += r.full_days;
        half += r.half_days;
        absent += r.absent;
        onLeave += r.on_leave;
        onDuty += r.on_duty;
      }
      const denominator = full + half + absent + onLeave;
      facultyAttendance = {
        percentage:
          denominator > 0
            ? Math.round(((full + half * 0.5) / denominator) * 100)
            : 0,
        reported: full + half,
        on_roll: denominator,
        on_leave: onLeave,
        on_duty: onDuty,
      };
    }

    return {
      department,
      faculty: {
        id: faculty.id,
        name: [faculty.prefix, faculty.first_name, faculty.last_name]
          .filter(Boolean)
          .join(' '),
        designation: faculty.designation,
      },
      scope,
      student_attendance: studentAttendance,
      faculty_attendance: facultyAttendance,
      average_cgpa: {
        value: reportsSummary.average_cgpa,
        change: reportsSummary.average_cgpa_change,
      },
      placements,
      needs_attention: needsAttention,
      up_next: upNext,
      announcements,
      my_department: {
        name: department.name,
        code: department.code,
        class_count: studentAttendanceTermToDate.class_count,
        student_count: studentAttendanceTermToDate.student_count,
        faculty_count: facultyOnRoll,
        attendance_percent: studentAttendanceTermToDate.percentage,
        below_threshold_count: needsAttention.below_threshold_student_count,
        average_cgpa: reportsSummary.average_cgpa,
        arrears_count: reportsSummary.arrears_count,
        placed_count: placements.placed_count,
        eligible_count: placements.eligible_count,
        pending_requests_count: needsAttention.pending_requests_count,
      },
    };
  }

  /**
   * "Today" is derived per-student (at least one `present` period marked
   * today), not per-period — attendance_records is one row per (student,
   * subject, period) so a raw row count would over/under-count against
   * "on roll" student totals. "On roll" is every active student in the
   * department's classes, matching how the reference dashboard phrases it
   * ("present of X on roll").
   *
   * "Term" instead counts every attendance mark recorded so far this term
   * (no date filter), so `present`/`on_roll` become "present-marks of
   * marks recorded" rather than a headcount — a genuinely different, real
   * figure from the "today" snapshot rather than the same number relabeled.
   */
  private async getStudentAttendance(
    departmentId: number,
    scope: 'today' | 'term',
  ) {
    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId },
      select: { id: true, section: true, current_semester: true },
    });
    const classIds = classes.map((c) => c.id);

    const students = await this.prisma.students.findMany({
      where: { class_id: { in: classIds }, status: 'active' },
      select: { id: true, class_id: true },
    });
    const activeStudentIds = new Set(students.map((s) => s.id));
    const onRoll = students.length;

    if (scope === 'today') {
      const today = new Date().toISOString().slice(0, 10);
      const todayDate = new Date(`${today}T00:00:00.000Z`);

      const presentToday = classIds.length
        ? await this.prisma.attendance_records.findMany({
            where: {
              class_id: { in: classIds },
              attendance_date: todayDate,
              status: 'present',
            },
            select: { student_id: true, class_id: true },
            distinct: ['student_id', 'class_id'],
          })
        : [];

      const presentStudentIds = new Set(presentToday.map((r) => r.student_id));

      const studentsByClass = new Map<number, number>();
      for (const s of students) {
        if (s.class_id == null) continue;
        studentsByClass.set(
          s.class_id,
          (studentsByClass.get(s.class_id) ?? 0) + 1,
        );
      }
      const presentByClass = new Map<number, number>();
      for (const r of presentToday) {
        presentByClass.set(
          r.class_id,
          (presentByClass.get(r.class_id) ?? 0) + 1,
        );
      }

      let classesAboveThreshold = 0;
      for (const c of classes) {
        const total = studentsByClass.get(c.id) ?? 0;
        const present = presentByClass.get(c.id) ?? 0;
        if (
          total > 0 &&
          (present / total) * 100 >= CLASS_ATTENDANCE_HEALTHY_PERCENT
        ) {
          classesAboveThreshold += 1;
        }
      }

      const present = [...presentStudentIds].filter((id) =>
        activeStudentIds.has(id),
      ).length;

      return {
        percentage: onRoll > 0 ? Math.round((present / onRoll) * 1000) / 10 : 0,
        present,
        on_roll: onRoll,
        student_count: onRoll,
        class_count: classes.length,
        classes_above_threshold: classesAboveThreshold,
        classes_above_threshold_total: classes.length,
      };
    }

    // scope === 'term'
    const attendanceRows = classIds.length
      ? await this.prisma.attendance_records.groupBy({
          by: ['student_id', 'class_id', 'status'],
          where: { class_id: { in: classIds } },
          _count: { _all: true },
        })
      : [];

    let totalPresent = 0;
    let totalMarked = 0;
    const classTotals = new Map<number, { present: number; total: number }>();
    for (const row of attendanceRows) {
      if (!activeStudentIds.has(row.student_id)) continue;
      totalMarked += row._count._all;
      if (row.status === 'present') totalPresent += row._count._all;

      const entry = classTotals.get(row.class_id) ?? {
        present: 0,
        total: 0,
      };
      entry.total += row._count._all;
      if (row.status === 'present') entry.present += row._count._all;
      classTotals.set(row.class_id, entry);
    }

    let classesAboveThreshold = 0;
    for (const c of classes) {
      const totals = classTotals.get(c.id);
      if (!totals || totals.total === 0) continue;
      if (
        (totals.present / totals.total) * 100 >=
        CLASS_ATTENDANCE_HEALTHY_PERCENT
      ) {
        classesAboveThreshold += 1;
      }
    }

    return {
      percentage:
        totalMarked > 0
          ? Math.round((totalPresent / totalMarked) * 1000) / 10
          : 0,
      present: totalPresent,
      on_roll: totalMarked,
      student_count: onRoll,
      class_count: classes.length,
      classes_above_threshold: classesAboveThreshold,
      classes_above_threshold_total: classes.length,
    };
  }

  /**
   * "Eligible final-year students" = students whose class is in the last
   * two semesters of their course's duration (duration_years * 2 - 1 and
   * duration_years * 2) — the only real "final year" signal available,
   * since there's no explicit is_final_year flag anywhere in the schema.
   */
  private async getPlacementsSummary(departmentId: number) {
    const students = await this.prisma.students.findMany({
      where: {
        classes: { department_id: departmentId },
        status: 'active',
      },
      select: {
        id: true,
        classes: {
          select: {
            current_semester: true,
            courses: { select: { duration_years: true } },
          },
        },
      },
    });

    const eligibleIds = students
      .filter((s) => {
        const semester = s.classes?.current_semester;
        const durationYears = s.classes?.courses.duration_years;
        if (semester == null || durationYears == null) return false;
        return semester >= durationYears * 2 - 1;
      })
      .map((s) => s.id);

    if (eligibleIds.length === 0) {
      return {
        placed_count: 0,
        eligible_count: 0,
        highest_package_lpa: null,
        average_package_lpa: null,
      };
    }

    const placedApplications =
      await this.prisma.student_drive_applications.findMany({
        where: { student_id: { in: eligibleIds }, status: 'placed' },
        select: { student_id: true, offered_package: true },
        distinct: ['student_id'],
      });

    const packages = placedApplications
      .map((p) =>
        p.offered_package != null ? Number(p.offered_package) : null,
      )
      .filter((p): p is number => p != null);

    return {
      placed_count: placedApplications.length,
      eligible_count: eligibleIds.length,
      highest_package_lpa: packages.length ? Math.max(...packages) : null,
      average_package_lpa: packages.length
        ? Math.round(
            (packages.reduce((a, b) => a + b, 0) / packages.length) * 100,
          ) / 100
        : null,
    };
  }

  /**
   * Every flag here is a real, currently-computable signal — none are
   * invented copy. Categories deliberately mirror the reference design's
   * spirit (low attendance, ungraded marks, unattended approvals, a
   * declining subject) without claiming to reproduce every exact line of
   * its demo text (e.g. "third consecutive week below threshold" would
   * need a week-over-week history table that doesn't exist anywhere yet).
   */
  private async getNeedsAttention(departmentId: number): Promise<{
    flags: AttentionFlag[];
    below_threshold_student_count: number;
    pending_requests_count: number;
    pending_leaves_count: number;
    pending_ods_count: number;
  }> {
    const classes = await this.prisma.classes.findMany({
      where: { department_id: departmentId },
      select: { id: true, section: true, current_semester: true },
    });
    const classIds = classes.map((c) => c.id);
    const flags: AttentionFlag[] = [];

    // Term-to-date attendance % per class, flagging any below 80%.
    const students = await this.prisma.students.findMany({
      where: { class_id: { in: classIds }, status: 'active' },
      select: { id: true, class_id: true },
    });
    const attendanceRows = classIds.length
      ? await this.prisma.attendance_records.groupBy({
          by: ['student_id', 'status'],
          where: { class_id: { in: classIds } },
          _count: { _all: true },
        })
      : [];
    const totalsByStudent = new Map<
      number,
      { present: number; total: number }
    >();
    for (const row of attendanceRows) {
      const entry = totalsByStudent.get(row.student_id) ?? {
        present: 0,
        total: 0,
      };
      entry.total += row._count._all;
      if (row.status === 'present') entry.present += row._count._all;
      totalsByStudent.set(row.student_id, entry);
    }
    const belowThresholdStudentIds = [...totalsByStudent.entries()]
      .filter(
        ([, v]) =>
          v.total > 0 &&
          (v.present / v.total) * 100 < ATTENDANCE_THRESHOLD_PERCENT,
      )
      .map(([studentId]) => studentId);
    if (belowThresholdStudentIds.length > 0) {
      flags.push({
        type: 'low_attendance_students',
        title: `${belowThresholdStudentIds.length} student${belowThresholdStudentIds.length === 1 ? '' : 's'} below ${ATTENDANCE_THRESHOLD_PERCENT}%`,
        detail: 'Term to date, across the department',
      });
    }

    const studentClassById = new Map(students.map((s) => [s.id, s.class_id]));
    const classTotals = new Map<number, { present: number; total: number }>();
    for (const [studentId, v] of totalsByStudent) {
      const classId = studentClassById.get(studentId);
      if (classId == null) continue;
      const entry = classTotals.get(classId) ?? { present: 0, total: 0 };
      entry.present += v.present;
      entry.total += v.total;
      classTotals.set(classId, entry);
    }
    for (const c of classes) {
      const totals = classTotals.get(c.id);
      if (!totals || totals.total === 0) continue;
      const pct = (totals.present / totals.total) * 100;
      if (pct < 80 && c.current_semester != null) {
        flags.push({
          type: 'low_attendance_class',
          title: `${yearLabelForSemester(c.current_semester)}-${c.section} attendance at ${Math.round(pct)}%`,
          detail: 'Term to date',
        });
      }
    }

    // Ungraded internal marks — most recent internal exam per class, subjects with any missing entry.
    const latestInternalExam = await this.prisma.exams.findFirst({
      where: {
        batches: { classes: { some: { department_id: departmentId } } },
        exam_types: { category: 'internal' },
      },
      orderBy: { start_date: 'desc' },
      select: { id: true, title: true },
    });
    if (latestInternalExam) {
      const mappings = await this.prisma.exam_subject_mapping.findMany({
        where: { exam_id: latestInternalExam.id, class_id: { in: classIds } },
        select: {
          id: true,
          class_id: true,
          _count: { select: { exam_marks: true } },
        },
      });
      const studentCountByClass = new Map<number, number>();
      for (const s of students) {
        if (s.class_id == null) continue;
        studentCountByClass.set(
          s.class_id,
          (studentCountByClass.get(s.class_id) ?? 0) + 1,
        );
      }
      const incompleteCount = mappings.filter(
        (m) => m._count.exam_marks < (studentCountByClass.get(m.class_id) ?? 0),
      ).length;
      if (incompleteCount > 0) {
        flags.push({
          type: 'marks_not_entered',
          title: `${latestInternalExam.title ?? 'Latest internal exam'} marks not entered · ${incompleteCount} subject${incompleteCount === 1 ? '' : 's'}`,
          detail: 'Some enrolled students have no mark recorded yet',
        });
      }
    }

    // Unattended faculty leave/OD (pending HoD decision).
    const [pendingLeaves, pendingOds] = await Promise.all([
      this.prisma.faculty_leaves.count({
        where: {
          faculty: { department_id: departmentId },
          hod_approval_status: 'pending',
        },
      }),
      this.prisma.faculty_od_requests.count({
        where: {
          faculty: { department_id: departmentId },
          hod_approval_status: 'pending',
        },
      }),
    ]);
    if (pendingLeaves + pendingOds > 0) {
      flags.push({
        type: 'pending_leave_od',
        title: `${pendingLeaves} leave and ${pendingOds} OD request${pendingLeaves + pendingOds === 1 ? '' : 's'} unattended`,
        detail: 'Awaiting your decision',
      });
    }

    // Declining class — reuse the same current-vs-previous-semester
    // comparison Reports & Analytics uses, surfacing the single worst mover.
    const comparisons =
      await this.hodReportsService.classComparisons(departmentId);
    const declining = comparisons
      .filter((c) => c.change_pts !== null && c.change_pts < 0)
      .sort((a, b) => (a.change_pts as number) - (b.change_pts as number))[0];
    if (declining) {
      flags.push({
        type: 'declining_class',
        title: `${declining.year}-${declining.section} pass % down ${Math.abs(declining.change_pts as number)} pts`,
        detail: `Semester ${declining.semester} vs semester ${declining.previous_semester}`,
      });
    }

    return {
      flags: flags.slice(0, 6),
      below_threshold_student_count: belowThresholdStudentIds.length,
      pending_requests_count: pendingLeaves + pendingOds,
      pending_leaves_count: pendingLeaves,
      pending_ods_count: pendingOds,
    };
  }

  /**
   * HoD's own remaining teaching periods today. Room/venue isn't tracked
   * anywhere on timetable_slots, so unlike the reference design's "Block C
   * 402", only subject + class + time are shown.
   */
  private async getUpNext(facultyId: number) {
    const dayOfWeek = new Date().getDay();
    const nowMinutes =
      new Date().getUTCHours() * 60 + new Date().getUTCMinutes();

    const slots = await this.prisma.timetable_slots.findMany({
      where: { faculty_id: facultyId, day_of_week: dayOfWeek },
      orderBy: { period_number: 'asc' },
      select: {
        id: true,
        period_number: true,
        start_time: true,
        end_time: true,
        subjects: { select: { name: true, subject_code: true } },
        classes: { select: { section: true, current_semester: true } },
      },
    });

    return slots
      .filter((s) => {
        const [h, m] = formatHHMM(s.end_time).split(':').map(Number);
        return h * 60 + m >= nowMinutes;
      })
      .slice(0, 3)
      .map((s) => ({
        id: s.id,
        period_label: `P${s.period_number}`,
        subject_code: s.subjects.subject_code,
        subject_name: s.subjects.name,
        class_label: s.classes.current_semester
          ? `${yearLabelForSemester(s.classes.current_semester)}-${s.classes.section}`
          : s.classes.section,
        start_time: formatHHMM(s.start_time),
        end_time: formatHHMM(s.end_time),
      }));
  }

  private async getAnnouncements(departmentId: number) {
    const rows = await this.prisma.announcements.findMany({
      where: {
        status: 'published',
        OR: [{ department_id: departmentId }, { department_id: null }],
      },
      orderBy: { created_at: 'desc' },
      take: 3,
      select: {
        id: true,
        title: true,
        target_audience: true,
        created_at: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      tag: r.target_audience.toUpperCase(),
      posted_at: r.created_at,
    }));
  }
}
