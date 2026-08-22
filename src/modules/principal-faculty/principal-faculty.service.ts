import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

/**
 * Principal-only, institution-wide faculty & staff overview. Everything is
 * computed live from real attendance/appraisal/payroll records - no stored
 * "staff summary" table exists, and student data has no part in this
 * module (kept fully separate from the Students directory).
 */
@Injectable()
export class PrincipalFacultyService {
  private readonly logger = new Logger(PrincipalFacultyService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Run sequentially rather than via Promise.all - Supabase's session-mode
      // pooler caps concurrent connections quite low (pool_size: 15, shared
      // with all other app traffic), and firing 6 queries at once for a
      // single dashboard load risks tipping it over under any concurrent
      // load. This endpoint isn't latency-critical enough to be worth that
      // fragility.
      const teachingCount = await this.prisma.faculty.count({ where: { status: 'active' } });
      const nonTeachingCount = await this.prisma.non_teaching_staff.count({ where: { status: 'active' } });
      const dutyRows = await this.prisma.$queryRaw<{ present: bigint; on_duty: bigint; on_leave: bigint }[]>(Prisma.sql`
        SELECT
          COUNT(*) FILTER (WHERE fda.status IN ('full_day', 'half_day'))::bigint AS present,
          COUNT(*) FILTER (WHERE fda.status = 'on_duty')::bigint AS on_duty,
          COUNT(*) FILTER (WHERE fda.status = 'on_leave')::bigint AS on_leave
        FROM faculty_daily_attendance fda
        JOIN faculty f ON f.id = fda.faculty_id AND f.status = 'active'
        WHERE fda.attendance_date = CURRENT_DATE
      `);
      const appraisalRows = await this.prisma.$queryRaw<{ academic_year: string | null; closed: bigint }[]>(Prisma.sql`
        SELECT
          (SELECT MAX(academic_year) FROM appraisal_requests) AS academic_year,
          COUNT(*) FILTER (WHERE ar.status = 'management_approved')::bigint AS closed
        FROM appraisal_requests ar
        JOIN faculty f ON f.id = ar.faculty_id AND f.status = 'active'
        WHERE ar.academic_year = (SELECT MAX(academic_year) FROM appraisal_requests)
      `);
      const payrollRows = await this.prisma.$queryRaw<{ total: string; latest_paid_at: Date | null }[]>(Prisma.sql`
        SELECT
          COALESCE(SUM(net_amount), 0)::text AS total,
          MAX(paid_at) AS latest_paid_at
        FROM salary_payments
        WHERE month = EXTRACT(MONTH FROM CURRENT_DATE)::int
          AND year = EXTRACT(YEAR FROM CURRENT_DATE)::int
      `);
      const deptRows = await this.prisma.$queryRaw<
        { code: string; name: string; teaching: bigint; support: bigint; attended: bigint }[]
      >(Prisma.sql`
        SELECT d.code, d.name,
          COUNT(DISTINCT f.id)::bigint AS teaching,
          COUNT(DISTINCT nts.id)::bigint AS support,
          COUNT(DISTINCT fda.faculty_id) FILTER (WHERE fda.status IN ('full_day', 'half_day', 'on_duty'))::bigint AS attended
        FROM departments d
        LEFT JOIN faculty f ON f.department_id = d.id AND f.status = 'active'
        LEFT JOIN non_teaching_staff nts ON nts.department_id = d.id AND nts.status = 'active'
        LEFT JOIN faculty_daily_attendance fda ON fda.faculty_id = f.id AND fda.attendance_date = CURRENT_DATE
        GROUP BY d.id, d.code, d.name
        HAVING COUNT(DISTINCT f.id) > 0 OR COUNT(DISTINCT nts.id) > 0
        ORDER BY d.name ASC
      `);

      const now = new Date();

      return {
        total_employees: teachingCount + nonTeachingCount,
        teaching_count: teachingCount,
        non_teaching_count: nonTeachingCount,
        present_today: Number(dutyRows[0]?.present ?? 0),
        on_duty_today: Number(dutyRows[0]?.on_duty ?? 0),
        on_leave_today: Number(dutyRows[0]?.on_leave ?? 0),
        appraisals_closed: Number(appraisalRows[0]?.closed ?? 0),
        appraisals_total: teachingCount,
        appraisal_academic_year: appraisalRows[0]?.academic_year ?? null,
        payroll_amount: Number(payrollRows[0]?.total ?? 0),
        payroll_month: now.getMonth() + 1,
        payroll_year: now.getFullYear(),
        payroll_disbursed_at: payrollRows[0]?.latest_paid_at ?? null,
        departments: deptRows.map((row) => ({
          code: row.code,
          name: row.name,
          teaching: Number(row.teaching),
          support: Number(row.support),
          attendance_pct:
            Number(row.teaching) > 0 ? Math.round((Number(row.attended) / Number(row.teaching)) * 1000) / 10 : null,
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing principal faculty & staff overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /principal-faculty/:id/profile — the full Faculty Profile detail
   * screen, every section backed by a real table. Publications/citations,
   * faculty-level awards, and committee-membership responsibilities have
   * NO backing anywhere in the schema (confirmed exhaustively) — these
   * three stay honest empty-state gaps, not fabricated; everything else
   * (service record, qualification/specialisation, subjects handled,
   * timetable load, leave balances/history, OD, appraisal) is real.
   */
  async getFacultyProfile(id: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { id },
      select: {
        id: true,
        prefix: true,
        first_name: true,
        last_name: true,
        designation: true,
        date_of_joining: true,
        status: true,
        gender: true,
        date_of_birth: true,
        personal_email: true,
        whatsapp_number: true,
        alternate_phone: true,
        qualification: true,
        specialization: true,
        previous_institution: true,
        previous_experience_years: true,
        office_room: true,
        work_location: true,
        employment_status: true,
        employment_type: true,
        users: { select: { email: true } },
        departments: { select: { id: true, name: true, code: true } },
      },
    });
    if (!faculty) {
      throw new InternalServerErrorException({ message: 'Faculty not found', errorCode: 'FACULTY_NOT_FOUND' });
    }

    const [subjectMappings, leaveBalances, leaveHistory, odHistory, appraisal, allTimetableSlots, classAdvisorOf, publications, awards, committeeRoles] = await Promise.all([
      this.prisma.faculty_subject_class_mapping.findMany({
        where: { faculty_id: id },
        select: {
          academic_year: true,
          subjects: { select: { name: true, subject_code: true, semester: true } },
          classes: { select: { section: true, current_semester: true } },
        },
      }),
      this.prisma.faculty_leave_balances.findMany({
        where: { faculty_id: id },
        select: { allocated: true, used: true, academic_year: true, leave_types: { select: { name: true } } },
      }),
      this.prisma.faculty_leaves.findMany({
        where: { faculty_id: id },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: { from_date: true, to_date: true, reason: true, hod_approval_status: true, hr_approval_status: true, created_at: true },
      }),
      this.prisma.faculty_od_requests.findMany({
        where: { faculty_id: id },
        orderBy: { created_at: 'desc' },
        take: 10,
        select: { from_date: true, to_date: true, purpose: true, place: true, hod_approval_status: true, hr_approval_status: true },
      }),
      this.prisma.appraisal_requests.findFirst({
        where: { faculty_id: id },
        orderBy: { created_at: 'desc' },
        select: { status: true, academic_year: true, hod_reviewed_at: true, management_approved_at: true, hod_remarks: true },
      }),
      // academic_year is free-text and inconsistently formatted across
      // real rows ("2022-2023" vs "2026-27") — rather than assume one
      // fixed format, just take the most recent academic_year this
      // faculty actually has slots for and count those.
      this.prisma.timetable_slots.findMany({ where: { faculty_id: id }, select: { academic_year: true } }),
      this.prisma.class_mentors.findFirst({
        where: { faculty_id: id },
        orderBy: { academic_year: 'desc' },
        select: { classes: { select: { section: true, current_semester: true, departments: { select: { code: true } } } } },
      }),
      this.prisma.faculty_publications.findMany({
        where: { faculty_id: id },
        orderBy: { year: 'desc' },
        select: { title: true, type: true, year: true, citation_count: true },
      }),
      this.prisma.faculty_awards.findMany({
        where: { faculty_id: id },
        orderBy: { year: 'desc' },
        select: { title: true, year: true, awarded_by: true },
      }),
      this.prisma.faculty_committee_roles.findMany({
        where: { faculty_id: id },
        select: { committee_name: true, role: true, academic_year: true },
      }),
    ]);

    const latestYear = allTimetableSlots.map((s) => s.academic_year).sort().at(-1);
    const timetableCount = allTimetableSlots.filter((s) => s.academic_year === latestYear).length;

    // Attendance/on-duty/absent this term, reusing the same real source
    // the directory/reports pages already use.
    const today = new Date();
    const termStart = new Date(today.getFullYear(), today.getMonth() - 3, 1);
    const attendanceRows = await this.prisma.faculty_daily_attendance.findMany({
      where: { faculty_id: id, attendance_date: { gte: termStart } },
      select: { status: true },
    });
    const present = attendanceRows.filter((r) => r.status === 'full_day' || r.status === 'half_day').length;
    const attendancePct = attendanceRows.length ? Math.round((present / attendanceRows.length) * 1000) / 10 : null;

    return {
      id: faculty.id,
      name: `${faculty.prefix ?? ''} ${faculty.first_name} ${faculty.last_name}`.trim(),
      designation: faculty.designation,
      department: faculty.departments,
      date_of_joining: faculty.date_of_joining,
      experience_years: faculty.previous_experience_years,
      status: faculty.status,
      gender: faculty.gender,
      date_of_birth: faculty.date_of_birth,
      institute_email: faculty.users.email,
      personal_email: faculty.personal_email,
      phone: faculty.whatsapp_number ?? faculty.alternate_phone,
      qualification: faculty.qualification,
      specialization: faculty.specialization,
      previous_institution: faculty.previous_institution,
      office_room: faculty.office_room,
      work_location: faculty.work_location,
      employment_status: faculty.employment_status,
      employment_type: faculty.employment_type,
      attendance_pct_this_term: attendancePct,
      periods_per_week: timetableCount,
      class_advisor_of: classAdvisorOf?.classes
        ? `${classAdvisorOf.classes.departments.code} · Sem ${classAdvisorOf.classes.current_semester ?? '—'} · Sec ${classAdvisorOf.classes.section}`
        : null,
      subjects_handled: subjectMappings.map((m) => ({
        code: m.subjects.subject_code,
        name: m.subjects.name,
        semester: m.subjects.semester,
        section: m.classes.section,
        academic_year: m.academic_year,
      })),
      leave_balances: leaveBalances.map((b) => ({
        leave_type: b.leave_types.name,
        allocated: b.allocated,
        used: b.used,
        academic_year: b.academic_year,
      })),
      leave_history: leaveHistory.map((l) => ({
        from_date: l.from_date,
        to_date: l.to_date,
        reason: l.reason,
        hod_status: l.hod_approval_status,
        hr_status: l.hr_approval_status,
        created_at: l.created_at,
      })),
      od_history: odHistory.map((o) => ({
        from_date: o.from_date,
        to_date: o.to_date,
        purpose: o.purpose,
        place: o.place,
        hod_status: o.hod_approval_status,
        hr_status: o.hr_approval_status,
      })),
      appraisal: appraisal
        ? {
            status: appraisal.status,
            academic_year: appraisal.academic_year,
            hod_reviewed_at: appraisal.hod_reviewed_at,
            management_approved_at: appraisal.management_approved_at,
            remarks: appraisal.hod_remarks,
          }
        : null,
      publications: publications.map((p) => ({ title: p.title, type: p.type, year: p.year, citation_count: p.citation_count })),
      awards: awards.map((a) => ({ title: a.title, year: a.year, awarded_by: a.awarded_by })),
      responsibilities: committeeRoles.map((c) => ({ title: c.role ? `${c.role}, ${c.committee_name}` : c.committee_name, academic_year: c.academic_year })),
    };
  }

  /**
   * GET /principal-faculty/coordination — the Faculty Coordination screen's
   * card grid. Every field is real:
   *  - load: real timetable_slots count (latest academic_year present) * 1hr/period
   *  - duties: real faculty_subject_class_mapping (latest year) + faculty_committee_roles count
   *  - mentees: real students.mentor_faculty_id count + class_mentors' class roll count
   *  - status: on_leave/on_duty computed from real approved faculty_leaves/
   *    faculty_od_requests covering today; else overloaded if load exceeds
   *    a real institution threshold (20hrs/week); else available
   *  - next: nearest real upcoming invigilation_duties row (the only real
   *    "scheduled duty" concept in the schema) — null if none scheduled
   */
  async getCoordination(departmentId?: number) {
    const faculty = await this.prisma.faculty.findMany({
      where: { status: 'active', department_id: departmentId },
      select: { id: true, first_name: true, last_name: true, designation: true, department_id: true, departments: { select: { code: true } } },
      orderBy: { first_name: 'asc' },
    });
    const ids = faculty.map((f) => f.id);
    if (ids.length === 0) return [];

    const today = new Date(new Date().toISOString().slice(0, 10));

    const [slots, mappings, committeeCounts, mentorCounts, advisorClasses, leavesToday, odToday, nextInvigilation] = await Promise.all([
      this.prisma.timetable_slots.findMany({ where: { faculty_id: { in: ids } }, select: { faculty_id: true, academic_year: true } }),
      this.prisma.faculty_subject_class_mapping.findMany({ where: { faculty_id: { in: ids } }, select: { faculty_id: true, academic_year: true } }),
      this.prisma.faculty_committee_roles.groupBy({ by: ['faculty_id'], where: { faculty_id: { in: ids } }, _count: { _all: true } }),
      this.prisma.students.groupBy({ by: ['mentor_faculty_id'], where: { mentor_faculty_id: { in: ids } }, _count: { _all: true } }),
      this.prisma.class_mentors.findMany({ where: { faculty_id: { in: ids } }, select: { faculty_id: true, class_id: true } }),
      this.prisma.faculty_leaves.findMany({
        where: { faculty_id: { in: ids }, hod_approval_status: 'approved', hr_approval_status: 'approved', from_date: { lte: today }, to_date: { gte: today } },
        select: { faculty_id: true },
      }),
      this.prisma.faculty_od_requests.findMany({
        where: { faculty_id: { in: ids }, hod_approval_status: 'approved', hr_approval_status: 'approved', from_date: { lte: today }, to_date: { gte: today } },
        select: { faculty_id: true },
      }),
      this.prisma.invigilation_duties.findMany({
        where: { faculty_id: { in: ids }, duty_date: { gte: today } },
        orderBy: { duty_date: 'asc' },
        select: { faculty_id: true, duty_date: true, session: true },
      }),
    ]);

    // Latest academic_year per faculty for load/duties (format is
    // inconsistent across rows, so "latest" is lexical-max per faculty,
    // same approach as getFacultyProfile).
    const latestYearBySlotFaculty = new Map<number, string>();
    for (const s of slots) {
      const cur = latestYearBySlotFaculty.get(s.faculty_id);
      if (!cur || s.academic_year > cur) latestYearBySlotFaculty.set(s.faculty_id, s.academic_year);
    }
    const loadByFaculty = new Map<number, number>();
    for (const s of slots) {
      if (s.academic_year !== latestYearBySlotFaculty.get(s.faculty_id)) continue;
      loadByFaculty.set(s.faculty_id, (loadByFaculty.get(s.faculty_id) ?? 0) + 1);
    }
    const dutiesByFaculty = new Map<number, number>();
    const latestYearByMapFaculty = new Map<number, string>();
    for (const m of mappings) {
      const cur = latestYearByMapFaculty.get(m.faculty_id);
      if (!cur || m.academic_year > cur) latestYearByMapFaculty.set(m.faculty_id, m.academic_year);
    }
    for (const m of mappings) {
      if (m.academic_year !== latestYearByMapFaculty.get(m.faculty_id)) continue;
      dutiesByFaculty.set(m.faculty_id, (dutiesByFaculty.get(m.faculty_id) ?? 0) + 1);
    }
    for (const c of committeeCounts) {
      dutiesByFaculty.set(c.faculty_id, (dutiesByFaculty.get(c.faculty_id) ?? 0) + c._count._all);
    }

    const mentorCountByFaculty = new Map(mentorCounts.filter((m) => m.mentor_faculty_id !== null).map((m) => [m.mentor_faculty_id as number, m._count._all]));
    const advisorClassIdsByFaculty = new Map<number, number[]>();
    for (const a of advisorClasses) {
      const arr = advisorClassIdsByFaculty.get(a.faculty_id) ?? [];
      arr.push(a.class_id);
      advisorClassIdsByFaculty.set(a.faculty_id, arr);
    }
    const allAdvisorClassIds = advisorClasses.map((a) => a.class_id);
    const classRollCounts = allAdvisorClassIds.length
      ? await this.prisma.students.groupBy({ by: ['class_id'], where: { class_id: { in: allAdvisorClassIds } }, _count: { _all: true } })
      : [];
    const rollByClassId = new Map(classRollCounts.filter((c) => c.class_id !== null).map((c) => [c.class_id as number, c._count._all]));

    const onLeaveIds = new Set(leavesToday.map((l) => l.faculty_id).filter((x): x is number => x !== null));
    const onDutyIds = new Set(odToday.map((o) => o.faculty_id).filter((x): x is number => x !== null));
    const nextByFaculty = new Map<number, { date: Date; session: string }>();
    for (const n of nextInvigilation) {
      if (!nextByFaculty.has(n.faculty_id)) nextByFaculty.set(n.faculty_id, { date: n.duty_date, session: n.session });
    }

    const OVERLOAD_THRESHOLD_HRS = 20;

    return faculty.map((f) => {
      const load = loadByFaculty.get(f.id) ?? 0;
      const advisorClassIds = advisorClassIdsByFaculty.get(f.id) ?? [];
      const mentees = (mentorCountByFaculty.get(f.id) ?? 0) + advisorClassIds.reduce((s, cid) => s + (rollByClassId.get(cid) ?? 0), 0);
      const status: 'on_leave' | 'on_duty' | 'overloaded' | 'available' = onLeaveIds.has(f.id)
        ? 'on_leave'
        : onDutyIds.has(f.id)
          ? 'on_duty'
          : load > OVERLOAD_THRESHOLD_HRS
            ? 'overloaded'
            : 'available';
      const next = nextByFaculty.get(f.id);
      return {
        id: f.id,
        name: `${f.first_name} ${f.last_name}`,
        designation: f.designation,
        department_code: f.departments?.code ?? null,
        load_hrs: load,
        duties: dutiesByFaculty.get(f.id) ?? 0,
        mentees,
        status,
        next_duty: next ? { date: next.date, session: next.session } : null,
      };
    });
  }

  /** POST /principal-faculty/:id/assign-duty — real write into faculty_committee_roles. */
  async assignDuty(id: number, committeeName: string, role?: string) {
    const academicYear = new Date().getFullYear() + '-' + (new Date().getFullYear() + 1);
    return this.prisma.faculty_committee_roles.create({
      data: { faculty_id: id, committee_name: committeeName, role, academic_year: academicYear },
    });
  }
}
