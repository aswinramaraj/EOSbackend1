import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { EligibilityQueryDto } from './dto/eligibility-query.dto';
import { CreateCondonationDto } from './dto/create-condonation.dto';
import { ReviewCondonationDto } from './dto/review-condonation.dto';

// No regulation is resolvable per-student yet (regulation_courses links a
// regulation to a programme, not a specific student's cohort), so 75% — the
// real value every seeded regulation currently shares — is used as the
// threshold constant here, same honest-constant pattern as marks-roster's
// GRADE_BANDS. Attendance itself is 100% real, from attendance_records.
const ATTENDANCE_THRESHOLD_PCT = 75;

const STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  classes: {
    select: {
      current_semester: true,
      departments: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

@Injectable()
export class AttendanceEligibilityService {
  constructor(private readonly prisma: PrismaService) {}

  private async computeRows(query: EligibilityQueryDto) {
    const exam = await this.prisma.exams.findUnique({ where: { id: query.exam_id } });
    if (!exam) throw new NotFoundException({ message: 'Exam not found.', errorCode: 'EXAM_NOT_FOUND' });

    const classes = await this.prisma.classes.findMany({
      where: { batch_id: exam.batch_id, ...(query.department_id ? { department_id: query.department_id } : {}) },
      select: { id: true },
    });
    const classIds = classes.map((c) => c.id);

    const students = await this.prisma.students.findMany({
      where: {
        class_id: { in: classIds },
        ...(query.search
          ? { OR: [{ student_id_no: { contains: query.search, mode: 'insensitive' } }, { register_no: { contains: query.search, mode: 'insensitive' } }] }
          : {}),
      },
      select: STUDENT_SELECT,
    });
    const studentIds = students.map((s) => s.id);

    const [records, condonations] = await Promise.all([
      this.prisma.attendance_records.findMany({
        where: { student_id: { in: studentIds }, is_published: true },
        select: { student_id: true, subject_id: true, status: true },
      }),
      this.prisma.condonation_requests.findMany({ where: { exam_id: query.exam_id, student_id: { in: studentIds } } }),
    ]);

    const condonationByStudent = new Map(condonations.map((c) => [c.student_id, c]));
    const recordsByStudent = new Map<number, typeof records>();
    for (const r of records) {
      const list = recordsByStudent.get(r.student_id) ?? [];
      list.push(r);
      recordsByStudent.set(r.student_id, list);
    }

    return students
      .map((s) => {
        const recs = recordsByStudent.get(s.id) ?? [];
        const total = recs.length;
        const attended = recs.filter((r) => r.status !== 'absent').length;
        const pct = total > 0 ? Math.round(((attended / total) * 100 + Number.EPSILON) * 10) / 10 : 100;

        const bySubject = new Map<number, { total: number; attended: number }>();
        for (const r of recs) {
          if (r.subject_id == null) continue;
          const e = bySubject.get(r.subject_id) ?? { total: 0, attended: 0 };
          e.total += 1;
          if (r.status !== 'absent') e.attended += 1;
          bySubject.set(r.subject_id, e);
        }
        const shortfallCourses = [...bySubject.values()].filter((v) => (v.attended / v.total) * 100 < ATTENDANCE_THRESHOLD_PCT).length;

        const condonation = condonationByStudent.get(s.id);
        let eligibility: 'eligible' | 'pending' | 'detained';
        if (pct >= ATTENDANCE_THRESHOLD_PCT) eligibility = 'eligible';
        else if (condonation?.status === 'approved') eligibility = 'eligible';
        else if (condonation?.status === 'requested') eligibility = 'pending';
        else eligibility = 'detained';

        return {
          id: s.id,
          student_id_no: s.student_id_no,
          register_no: s.register_no,
          roll_no: s.roll_no,
          name: s.soa_applications ? [s.soa_applications.first_name, s.soa_applications.last_name].filter(Boolean).join(' ') : null,
          department: s.classes?.departments ?? null,
          semester: s.classes?.current_semester ?? null,
          attendance_pct: pct,
          shortfall_courses: shortfallCourses,
          condonation_status: condonation?.status ?? null,
          condonation_id: condonation?.id ?? null,
          eligibility,
        };
      })
      .filter((row) => !query.eligibility || row.eligibility === query.eligibility);
  }

  async findAll(query: EligibilityQueryDto) {
    return this.computeRows(query);
  }

  async getStats(query: Pick<EligibilityQueryDto, 'exam_id'>) {
    const rows = await this.computeRows({ exam_id: query.exam_id });
    return {
      total: rows.length,
      eligible_count: rows.filter((r) => r.eligibility === 'eligible').length,
      below_threshold_count: rows.filter((r) => r.attendance_pct < ATTENDANCE_THRESHOLD_PCT).length,
      detained_count: rows.filter((r) => r.eligibility === 'detained').length,
      condonation_pending_count: rows.filter((r) => r.condonation_status === 'requested').length,
      threshold_pct: ATTENDANCE_THRESHOLD_PCT,
    };
  }

  async createCondonation(dto: CreateCondonationDto) {
    const student = await this.prisma.students.findUnique({ where: { id: dto.student_id } });
    if (!student) throw new NotFoundException({ message: 'Student not found.', errorCode: 'STUDENT_NOT_FOUND' });
    const exam = await this.prisma.exams.findUnique({ where: { id: dto.exam_id } });
    if (!exam) throw new NotFoundException({ message: 'Exam not found.', errorCode: 'EXAM_NOT_FOUND' });

    return this.prisma.condonation_requests.upsert({
      where: { student_id_exam_id: { student_id: dto.student_id, exam_id: dto.exam_id } },
      create: { student_id: dto.student_id, exam_id: dto.exam_id, reason: dto.reason, status: 'requested' },
      update: { reason: dto.reason, status: 'requested' },
    });
  }

  async reviewCondonation(id: number, dto: ReviewCondonationDto, reviewedByUserId: number) {
    const existing = await this.prisma.condonation_requests.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Condonation request not found.', errorCode: 'CONDONATION_NOT_FOUND' });

    return this.prisma.condonation_requests.update({
      where: { id },
      data: { status: dto.status, reviewed_by_user_id: reviewedByUserId, reviewed_at: new Date() },
    });
  }
}
