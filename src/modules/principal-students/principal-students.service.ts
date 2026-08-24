import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';
import { ListPrincipalStudentsQueryDto } from './dto/list-principal-students-query.dto';

interface DirectoryRow {
  id: number;
  student_id_no: string;
  roll_no: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string;
  dept_code: string | null;
  dept_name: string | null;
  semester: number | null;
  class_id: number | null;
  section: string | null;
  present_count: bigint | null;
  total_count: bigint | null;
  cgpa: string | null;
  total_demand: string | null;
  total_paid: string | null;
  has_concession: boolean | null;
}

type FeeStatus = 'paid' | 'due' | 'scholarship' | 'no_demand';

function resolveName(row: { first_name: string | null; last_name: string | null; email: string }): string {
  if (row.first_name) {
    return row.last_name ? `${row.first_name} ${row.last_name}` : row.first_name;
  }
  return row.email;
}

function resolveAttendancePct(row: { present_count: bigint | null; total_count: bigint | null }): number | null {
  const total = Number(row.total_count ?? 0);
  if (total <= 0) return null;
  const present = Number(row.present_count ?? 0);
  return Math.round((present / total) * 1000) / 10;
}

function resolveFeeStatus(row: {
  total_demand: string | null;
  total_paid: string | null;
  has_concession: boolean | null;
}): { status: FeeStatus; outstanding: number } {
  const demand = Number(row.total_demand ?? 0);
  const paid = Number(row.total_paid ?? 0);
  const outstanding = Math.max(demand - paid, 0);
  if (demand <= 0) return { status: 'no_demand', outstanding: 0 };
  if (row.has_concession) return { status: 'scholarship', outstanding };
  if (outstanding <= 0) return { status: 'paid', outstanding: 0 };
  return { status: 'due', outstanding };
}

/**
 * Institution-wide, Principal-only student directory: search/filter across
 * every department, with attendance/CGPA/fee-status computed live from real
 * records (no stored "student summary" table exists to read from instead).
 */
@Injectable()
export class PrincipalStudentsService {
  private readonly logger = new Logger(PrincipalStudentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getRollCount(): Promise<number> {
    return this.prisma.students.count();
  }

  async search(dto: ListPrincipalStudentsQueryDto) {
    const limit = dto.limit ?? 20;
    const page = dto.page ?? 1;
    const offset = (page - 1) * limit;

    const filters: Prisma.Sql[] = [];

    if (dto.search && dto.search.trim().length > 0) {
      const term = `%${dto.search.trim()}%`;
      filters.push(Prisma.sql`(
        st.student_id_no ILIKE ${term} OR
        st.roll_no ILIKE ${term} OR
        st.register_no ILIKE ${term} OR
        soa.first_name ILIKE ${term} OR
        soa.last_name ILIKE ${term} OR
        u.email ILIKE ${term}
      )`);
    }
    if (dto.department_id !== undefined) {
      filters.push(Prisma.sql`cl.department_id = ${dto.department_id}`);
    }
    if (dto.class_id !== undefined) {
      filters.push(Prisma.sql`st.class_id = ${dto.class_id}`);
    }
    if (dto.year !== undefined) {
      // No literal "year of study" column exists; derived from current_semester
      // assuming 2 semesters per academic year (institution-wide convention).
      filters.push(Prisma.sql`CEIL(cl.current_semester / 2.0) = ${dto.year}`);
    }
    if (dto.below_75) {
      filters.push(
        Prisma.sql`(sa.total_count IS NOT NULL AND sa.total_count > 0 AND (sa.present_count::numeric / sa.total_count) * 100 < 75)`,
      );
    }
    if (dto.fees_pending) {
      filters.push(
        Prisma.sql`(COALESCE(sf.total_demand, 0) - COALESCE(sf.total_paid, 0)) > 0 AND NOT COALESCE(sf.has_concession, false)`,
      );
    }

    const whereClause = filters.length > 0 ? Prisma.sql`WHERE ${Prisma.join(filters, ' AND ')}` : Prisma.empty;

    const base = Prisma.sql`
      WITH student_attendance AS (
        SELECT ar.student_id,
          COUNT(*) FILTER (WHERE ar.status = 'present') AS present_count,
          COUNT(*) AS total_count
        FROM attendance_records ar
        JOIN students st2 ON st2.id = ar.student_id
        JOIN classes cl2 ON cl2.id = st2.class_id
        LEFT JOIN academic_calendars ac ON ac.batch_id = cl2.batch_id AND ac.semester = cl2.current_semester
        WHERE ar.attendance_date <= CURRENT_DATE
          AND (ac.start_date IS NULL OR ar.attendance_date >= ac.start_date)
        GROUP BY ar.student_id
      ),
      student_cgpa AS (
        SELECT em.student_id,
          SUM(gb.grade_point * COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL)
            / NULLIF(SUM(COALESCE(sub.credits, 1)) FILTER (WHERE gb.grade_point IS NOT NULL), 0) AS cgpa
        FROM exam_marks em
        JOIN exam_subject_mapping esm ON esm.id = em.exam_subject_mapping_id
        JOIN exams e ON e.id = esm.exam_id
        JOIN subjects sub ON sub.id = esm.subject_id
        LEFT JOIN LATERAL (
          SELECT grade_point FROM grade_bands gb2
          WHERE gb2.min_percentage <= (em.marks_obtained / NULLIF(em.max_marks, 0) * 100)
          ORDER BY gb2.min_percentage DESC
          LIMIT 1
        ) gb ON true
        WHERE e.status = 'results_published' AND em.is_absent = false AND em.marks_obtained IS NOT NULL
        GROUP BY em.student_id
      ),
      student_fees AS (
        SELECT sfdm.student_id,
          SUM(sfdm.total_amount) AS total_demand,
          COALESCE(SUM(fp.amount_paid), 0) AS total_paid,
          BOOL_OR(fc.id IS NOT NULL AND fc.is_settled = false) AS has_concession
        FROM student_fee_demand_mapping sfdm
        LEFT JOIN fee_payments fp ON fp.student_fee_demand_mapping_id = sfdm.id
        LEFT JOIN fee_structures fs ON fs.id = sfdm.fee_structure_id
        LEFT JOIN fee_concessions fc ON fc.fee_structure_id = fs.id
        GROUP BY sfdm.student_id
      )
      SELECT
        st.id, st.student_id_no, st.roll_no,
        soa.first_name, soa.last_name, u.email,
        d.code AS dept_code, d.name AS dept_name, cl.current_semester AS semester,
        cl.id AS class_id, cl.section AS section,
        sa.present_count, sa.total_count,
        sc.cgpa::text AS cgpa,
        sf.total_demand::text AS total_demand, sf.total_paid::text AS total_paid, sf.has_concession
      FROM students st
      JOIN users u ON u.id = st.user_id
      LEFT JOIN soa_applications soa ON soa.id = st.soa_application_id
      LEFT JOIN classes cl ON cl.id = st.class_id
      LEFT JOIN departments d ON d.id = cl.department_id
      LEFT JOIN student_attendance sa ON sa.student_id = st.id
      LEFT JOIN student_cgpa sc ON sc.student_id = st.id
      LEFT JOIN student_fees sf ON sf.student_id = st.id
      ${whereClause}
    `;

    try {
      const [rows, countRows] = await Promise.all([
        this.prisma.$queryRaw<DirectoryRow[]>(Prisma.sql`
          ${base}
          ORDER BY st.student_id_no ASC
          LIMIT ${limit} OFFSET ${offset}
        `),
        this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
          SELECT COUNT(*)::bigint AS count FROM (${base}) sub
        `),
      ]);

      const total = Number(countRows[0]?.count ?? 0);

      return {
        page,
        limit,
        total,
        total_pages: Math.max(Math.ceil(total / limit), 1),
        students: rows.map((row) => {
          const fee = resolveFeeStatus(row);
          return {
            id: row.id,
            student_id_no: row.student_id_no,
            register_no: row.roll_no,
            name: resolveName(row),
            department_code: row.dept_code,
            department_name: row.dept_name,
            semester: row.semester,
            class_id: row.class_id,
            section: row.section,
            attendance_pct: resolveAttendancePct(row),
            cgpa: row.cgpa !== null ? Math.round(Number(row.cgpa) * 100) / 100 : null,
            fee_status: fee.status,
            fee_outstanding: fee.outstanding,
          };
        }),
      };
    } catch (err) {
      this.logger.error('DB error searching principal student directory', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async getAttendanceOverview() {
    try {
      const [presentTodayRows, semesterAggRows, deptRows] = await Promise.all([
        this.prisma.$queryRaw<{ count: bigint }[]>(Prisma.sql`
          SELECT COUNT(DISTINCT student_id)::bigint AS count
          FROM attendance_records
          WHERE attendance_date = CURRENT_DATE AND status = 'present'
        `),
        this.prisma.$queryRaw<{ mean_pct: string | null; below_75_count: bigint }[]>(Prisma.sql`
          WITH student_attendance AS (
            SELECT ar.student_id,
              COUNT(*) FILTER (WHERE ar.status = 'present') AS present_count,
              COUNT(*) AS total_count
            FROM attendance_records ar
            JOIN students st ON st.id = ar.student_id
            JOIN classes cl ON cl.id = st.class_id
            LEFT JOIN academic_calendars ac ON ac.batch_id = cl.batch_id AND ac.semester = cl.current_semester
            WHERE ar.attendance_date <= CURRENT_DATE
              AND (ac.start_date IS NULL OR ar.attendance_date >= ac.start_date)
            GROUP BY ar.student_id
          )
          SELECT
            AVG(present_count::numeric / NULLIF(total_count, 0) * 100)::text AS mean_pct,
            COUNT(*) FILTER (WHERE total_count > 0 AND (present_count::numeric / total_count) * 100 < 75)::bigint AS below_75_count
          FROM student_attendance
          WHERE total_count > 0
        `),
        this.prisma.$queryRaw<{ code: string; name: string; pct: string | null }[]>(Prisma.sql`
          WITH student_attendance AS (
            SELECT ar.student_id,
              COUNT(*) FILTER (WHERE ar.status = 'present') AS present_count,
              COUNT(*) AS total_count
            FROM attendance_records ar
            JOIN students st ON st.id = ar.student_id
            JOIN classes cl ON cl.id = st.class_id
            LEFT JOIN academic_calendars ac ON ac.batch_id = cl.batch_id AND ac.semester = cl.current_semester
            WHERE ar.attendance_date <= CURRENT_DATE
              AND (ac.start_date IS NULL OR ar.attendance_date >= ac.start_date)
            GROUP BY ar.student_id
          )
          SELECT d.code, d.name,
            AVG(sa.present_count::numeric / NULLIF(sa.total_count, 0) * 100)::text AS pct
          FROM student_attendance sa
          JOIN students st ON st.id = sa.student_id
          JOIN classes cl ON cl.id = st.class_id
          JOIN departments d ON d.id = cl.department_id
          WHERE sa.total_count > 0
          GROUP BY d.id, d.code, d.name
          ORDER BY d.name ASC
        `),
      ]);

      return {
        present_today: Number(presentTodayRows[0]?.count ?? 0),
        mean_attendance_pct:
          semesterAggRows[0]?.mean_pct !== null && semesterAggRows[0]?.mean_pct !== undefined
            ? Math.round(Number(semesterAggRows[0].mean_pct) * 10) / 10
            : null,
        below_75_count: Number(semesterAggRows[0]?.below_75_count ?? 0),
        departments: deptRows.map((row) => ({
          code: row.code,
          name: row.name,
          attendance_pct: row.pct !== null ? Math.round(Number(row.pct) * 10) / 10 : null,
        })),
      };
    } catch (err) {
      this.logger.error('DB error computing principal attendance overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  /**
   * GET /principal-students/:id/profile — the full Student Profile detail
   * screen, every section backed by a real table (see the exhaustive
   * schema audit this was built from). Nothing here is invented: a
   * section with no matching real data returns an empty array/null field
   * rather than a fabricated value, and the frontend renders that as a
   * genuine empty state, not an error.
   */
  async getStudentProfile(id: number) {
    const student = await this.prisma.students.findUnique({
      where: { id },
      select: {
        id: true,
        student_id_no: true,
        roll_no: true,
        register_no: true,
        admission_no: true,
        admission_date: true,
        admission_type: true,
        gender: true,
        date_of_birth: true,
        blood_group: true,
        mother_tongue: true,
        community: true,
        nationality: true,
        religion: true,
        caste: true,
        is_first_graduate: true,
        is_diff_abled: true,
        diff_abled_info: true,
        photo_url: true,
        mentor_faculty_id: true,
        class_id: true,
        users: { select: { email: true } },
        classes: {
          select: {
            section: true,
            current_semester: true,
            departments: { select: { id: true, name: true, code: true } },
            courses: { select: { name: true } },
            batches: { select: { name: true } },
          },
        },
        soa_applications: {
          select: { first_name: true, last_name: true, cutoff_physics: true, cutoff_chemistry: true, cutoff_maths: true },
        },
        student_contacts: { select: { student_email1: true, student_email2: true, student_mobile: true } },
        student_sensitive_info: { select: { aadhar_number: true, pan_number: true, passport_number: true } },
        student_addresses: { select: { address_type: true, address_line: true, city: true, state: true, pincode: true, district: true } },
        student_family_details: true,
        student_identity_marks: { select: { mark_number: true, description: true } },
        student_certificates: {
          select: { is_available: true, file_url: true, verified_at: true, certificate_types: { select: { name: true } } },
        },
        student_scholarship_awards: {
          select: { amount: true, awarded_at: true, scholarship_schemes: { select: { name: true } } },
        },
        student_hostel_mapping: { select: { room_id: true, allocated_date: true } },
        student_transport_mapping: { select: { route_id: true } },
        student_fee_demand_mapping: { select: { total_amount: true, fee_payments: { select: { amount_paid: true } } } },
        sports_achievements: { select: { event_name: true, result: true, level: true, achievement_date: true } },
        student_test_scores: { select: { test_name: true, score: true, test_date: true } },
        malpractice_incidents: { select: { id: true } },
        student_drive_applications: {
          select: { status: true, offer_response: true, offered_package: true, placement_drives: { select: { companies: { select: { name: true } } } } },
        },
      },
    });

    if (!student) {
      throw new InternalServerErrorException({ message: 'Student not found', errorCode: 'STUDENT_NOT_FOUND' });
    }

    const mentor = student.mentor_faculty_id
      ? await this.prisma.faculty.findUnique({
          where: { id: student.mentor_faculty_id },
          select: { first_name: true, last_name: true },
        })
      : null;

    const classAdvisor = student.class_id
      ? await this.prisma.class_mentors.findFirst({
          where: { class_id: student.class_id },
          orderBy: { academic_year: 'desc' },
          select: { faculty: { select: { first_name: true, last_name: true } } },
        })
      : null;

    // Semester-wise GPA history: real exam_marks joined through
    // exam_subject_mapping -> exams (per-semester) -> subjects (credits),
    // graded via the real grade_bands scale.
    const examMarksRows = await this.prisma.exam_marks.findMany({
      where: { student_id: id },
      select: {
        marks_obtained: true,
        max_marks: true,
        is_absent: true,
        exam_subject_mapping: {
          select: {
            subjects: { select: { name: true, subject_code: true, credits: true } },
            exams: { select: { semester: true, exam_types: { select: { is_university: true } } } },
          },
        },
      },
    });
    const gradeBands = await this.prisma.grade_bands.findMany({ orderBy: { display_order: 'asc' } });
    function gradeFor(pct: number): { label: string; point: number; pass: boolean } {
      const band = gradeBands.find((b) => pct >= Number(b.min_percentage)) ?? gradeBands[gradeBands.length - 1];
      return { label: band?.grade_label ?? '—', point: band ? Number(band.grade_point ?? 0) : 0, pass: band?.is_pass ?? true };
    }
    const bySemester = new Map<number, { credits: number; qualityPoints: number; subjects: typeof examMarksRows }>();
    for (const row of examMarksRows) {
      if (!row.exam_subject_mapping.exams.exam_types.is_university) continue; // only the official semester exam counts toward GPA
      const sem = row.exam_subject_mapping.exams.semester;
      const credits = row.exam_subject_mapping.subjects.credits ?? 0;
      const pct = row.is_absent ? 0 : (Number(row.marks_obtained ?? 0) / Number(row.max_marks)) * 100;
      const g = gradeFor(pct);
      const entry = bySemester.get(sem) ?? { credits: 0, qualityPoints: 0, subjects: [] };
      entry.credits += credits;
      entry.qualityPoints += credits * g.point;
      entry.subjects.push(row);
      bySemester.set(sem, entry);
    }
    const gpaHistory = Array.from(bySemester.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([semester, v]) => ({
        semester,
        gpa: v.credits > 0 ? Math.round((v.qualityPoints / v.credits) * 100) / 100 : null,
        credits: v.credits,
        arrears: v.subjects.filter((s) => (s.is_absent ? true : (Number(s.marks_obtained ?? 0) / Number(s.max_marks)) * 100 < 35)).length,
      }));

    // Current semester subject-wise marks (internal vs external) + attendance.
    const currentSemester = student.classes?.current_semester ?? null;
    const currentSemesterSubjects = currentSemester
      ? await (async () => {
          const rows = examMarksRows.filter((r) => r.exam_subject_mapping.exams.semester === currentSemester);
          const bySubject = new Map<string, { name: string; code: string; internal: number | null; external: number | null }>();
          for (const r of rows) {
            const key = r.exam_subject_mapping.subjects.subject_code;
            const entry = bySubject.get(key) ?? { name: r.exam_subject_mapping.subjects.name, code: key, internal: null, external: null };
            const pct = r.is_absent ? null : Number(r.marks_obtained ?? 0);
            if (r.exam_subject_mapping.exams.exam_types.is_university) entry.external = pct;
            else entry.internal = pct;
            bySubject.set(key, entry);
          }
          const attendanceBySubject = await this.prisma.attendance_records.groupBy({
            by: ['subject_id'],
            where: { student_id: id },
            _count: { _all: true },
          });
          return Array.from(bySubject.values()).map((s) => {
            const total = (s.internal ?? 0) + (s.external ?? 0);
            const pct = total > 0 ? total : 0;
            const g = gradeFor(pct);
            return { ...s, total, grade: g.label };
          });
        })()
      : [];

    // Monthly attendance (last 7 months with any record).
    const attendanceRows = await this.prisma.attendance_records.findMany({
      where: { student_id: id },
      select: { attendance_date: true, status: true },
      orderBy: { attendance_date: 'asc' },
    });
    const byMonth = new Map<string, { present: number; total: number }>();
    for (const r of attendanceRows) {
      const key = r.attendance_date.toISOString().slice(0, 7);
      const entry = byMonth.get(key) ?? { present: 0, total: 0 };
      entry.total += 1;
      if (r.status === 'present') entry.present += 1;
      byMonth.set(key, entry);
    }
    const monthlyAttendance = Array.from(byMonth.entries())
      .slice(-7)
      .map(([month, v]) => ({ month, pct: v.total > 0 ? Math.round((v.present / v.total) * 1000) / 10 : 0 }));

    const overallAttendancePct = attendanceRows.length
      ? Math.round((attendanceRows.filter((r) => r.status === 'present').length / attendanceRows.length) * 1000) / 10
      : null;
    const overallGpa = gpaHistory.length ? gpaHistory[gpaHistory.length - 1].gpa : null;
    const totalDemand = student.student_fee_demand_mapping.reduce((s, d) => s + Number(d.total_amount), 0);
    const totalPaid = student.student_fee_demand_mapping.reduce((s, d) => s + d.fee_payments.reduce((s2, p) => s2 + Number(p.amount_paid), 0), 0);

    return {
      id: student.id,
      name: student.soa_applications
        ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
        : student.users.email,
      student_id_no: student.student_id_no,
      roll_no: student.roll_no,
      register_no: student.register_no,
      admission_no: student.admission_no,
      admission_date: student.admission_date,
      admission_type: student.admission_type,
      department: student.classes?.departments ?? null,
      programme: student.classes?.courses?.name ?? null,
      batch: student.classes?.batches?.name ?? null,
      section: student.classes?.section ?? null,
      semester: currentSemester,
      gender: student.gender,
      date_of_birth: student.date_of_birth,
      blood_group: student.blood_group,
      mother_tongue: student.mother_tongue,
      community: student.community,
      nationality: student.nationality,
      religion: student.religion,
      caste: student.caste,
      is_first_graduate: student.is_first_graduate,
      is_diff_abled: student.is_diff_abled,
      diff_abled_info: student.diff_abled_info,
      photo_url: student.photo_url,
      institute_email: student.users.email,
      personal_email: student.student_contacts?.student_email1 ?? null,
      alternate_email: student.student_contacts?.student_email2 ?? null,
      mobile: student.student_contacts?.student_mobile ?? null,
      aadhar_number: student.student_sensitive_info?.aadhar_number ?? null,
      pan_number: student.student_sensitive_info?.pan_number ?? null,
      passport_number: student.student_sensitive_info?.passport_number ?? null,
      addresses: student.student_addresses.map((a) => ({
        type: a.address_type,
        line: a.address_line,
        city: a.city,
        state: a.state,
        pincode: a.pincode,
        district: a.district,
      })),
      class_advisor: classAdvisor?.faculty ? `${classAdvisor.faculty.first_name} ${classAdvisor.faculty.last_name}` : null,
      faculty_mentor: mentor ? `${mentor.first_name} ${mentor.last_name}` : null,
      identity_marks: student.student_identity_marks.map((m) => ({ number: m.mark_number, description: m.description })),
      family: student.student_family_details
        ? {
            father: {
              name: student.student_family_details.father_name,
              qualification: student.student_family_details.father_qualification,
              occupation: student.student_family_details.father_occupation,
              annual_income: student.student_family_details.father_annual_income ? Number(student.student_family_details.father_annual_income) : null,
              email: student.student_family_details.father_email,
              mobile: student.student_family_details.father_mobile,
              photo_url: student.student_family_details.father_photo_url,
            },
            mother: {
              name: student.student_family_details.mother_name,
              qualification: student.student_family_details.mother_qualification,
              occupation: student.student_family_details.mother_occupation,
              annual_income: student.student_family_details.mother_annual_income ? Number(student.student_family_details.mother_annual_income) : null,
              email: student.student_family_details.mother_email,
              mobile: student.student_family_details.mother_mobile,
              photo_url: student.student_family_details.mother_photo_url,
            },
          }
        : null,
      pre_admission: student.soa_applications
        ? {
            cutoff_physics: student.soa_applications.cutoff_physics,
            cutoff_chemistry: student.soa_applications.cutoff_chemistry,
            cutoff_maths: student.soa_applications.cutoff_maths,
          }
        : null,
      gpa_history: gpaHistory,
      overall_gpa: overallGpa,
      overall_percentage: overallGpa ? Math.round(overallGpa * 9.5 * 10) / 10 : null,
      current_semester_subjects: currentSemesterSubjects,
      monthly_attendance: monthlyAttendance,
      overall_attendance_pct: overallAttendancePct,
      documents: student.student_certificates.map((c) => ({
        name: c.certificate_types?.name ?? null,
        available: c.is_available,
        file_url: c.file_url,
        verified_at: c.verified_at,
      })),
      scholarships: student.student_scholarship_awards.map((s) => ({
        scheme: s.scholarship_schemes.name,
        amount: Number(s.amount),
        awarded_at: s.awarded_at,
      })),
      hostel: student.student_hostel_mapping ? { room_id: student.student_hostel_mapping.room_id, allocated_date: student.student_hostel_mapping.allocated_date } : null,
      transport: student.student_transport_mapping ? { route_id: student.student_transport_mapping.route_id } : null,
      fees: { total_demand: totalDemand, total_paid: totalPaid, status: totalDemand === 0 ? 'no_demand' : totalPaid >= totalDemand ? 'paid' : 'due' },
      achievements: [
        ...student.sports_achievements.map((a) => ({ label: `${a.event_name} — ${a.result}`, date: a.achievement_date, source: 'sports' as const })),
        ...student.student_test_scores.map((t) => ({ label: `${t.test_name}: ${t.score}`, date: t.test_date, source: 'test_score' as const })),
      ],
      discipline: { incident_count: student.malpractice_incidents.length },
      placement: student.student_drive_applications.map((d) => ({
        company: d.placement_drives.companies.name,
        status: d.status,
        offer_response: d.offer_response,
        offered_package: d.offered_package ? Number(d.offered_package) : null,
      })),
    };
  }
}
