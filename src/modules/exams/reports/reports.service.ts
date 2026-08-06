import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { ReportTable } from 'src/modules/library/reports/report-export.util';
import { ResultsService } from 'src/modules/exams/results/results.service';

function studentName(student: {
  student_id_no: string;
  soa_applications: { first_name: string; last_name: string | null } | null;
  users?: { email: string } | null;
}): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users?.email ?? `Student ${student.student_id_no}`;
}

function toTime(date: Date): string {
  return date.toISOString().slice(11, 16);
}

function toDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const STUDENT_SELECT = {
  student_id_no: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  users: { select: { email: true } },
} as const;

@Injectable()
export class ExamReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly resultsService: ResultsService,
  ) {}

  private async assertExamExists(examId: number) {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found.',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }
  }

  /** 1. EXAMINATION SCHEDULE — every published timetable slot for this exam. */
  async examinationSchedule(examId: number): Promise<ReportTable> {
    await this.assertExamExists(examId);

    const slots = await this.prisma.exam_timetable.findMany({
      where: {
        exam_subject_mapping: { exam_id: examId },
        exam_timetable_versions: { status: 'published' },
      },
      include: {
        exam_subject_mapping: { include: { subjects: true, classes: true } },
        venues: true,
      },
      orderBy: [{ exam_date: 'asc' }, { session: 'asc' }],
    });

    return {
      title: 'Examination schedule report',
      columns: [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Session', key: 'session', width: 10 },
        { header: 'Subject', key: 'subject', width: 26 },
        { header: 'Code', key: 'subject_code', width: 12 },
        { header: 'Class', key: 'class_section', width: 10 },
        { header: 'Venue', key: 'venue', width: 20 },
        { header: 'Start', key: 'start_time', width: 10 },
        { header: 'End', key: 'end_time', width: 10 },
      ],
      rows: slots.map((s) => ({
        date: toDate(s.exam_date),
        session: s.session,
        subject: s.exam_subject_mapping.subjects.name,
        subject_code: s.exam_subject_mapping.subjects.subject_code,
        class_section: s.exam_subject_mapping.classes.section,
        venue: s.venues?.name ?? '',
        start_time: toTime(s.start_time),
        end_time: toTime(s.end_time),
      })),
    };
  }

  /** 2. HALL ALLOCATION — every hall plan for this exam, with occupancy. */
  async hallAllocation(examId: number): Promise<ReportTable> {
    await this.assertExamExists(examId);

    const hallPlans = await this.prisma.hall_plans.findMany({
      where: { exam_id: examId },
      include: {
        venues: true,
        _count: {
          select: { seating_arrangements: true, invigilation_duties: true },
        },
      },
      orderBy: { exam_date: 'asc' },
    });

    return {
      title: 'Hall allocation report',
      columns: [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Venue', key: 'venue', width: 22 },
        { header: 'Capacity', key: 'capacity', width: 10 },
        { header: 'Seated', key: 'seated', width: 10 },
        { header: 'Invigilators', key: 'invigilators', width: 12 },
      ],
      rows: hallPlans.map((hp) => ({
        date: toDate(hp.exam_date),
        venue: hp.venues.name,
        capacity: hp.capacity ?? hp.venues.capacity ?? 0,
        seated: hp._count.seating_arrangements,
        invigilators: hp._count.invigilation_duties,
      })),
    };
  }

  /** 3. SEAT ALLOCATION — every seat assignment for this exam. */
  async seatAllocation(examId: number): Promise<ReportTable> {
    await this.assertExamExists(examId);

    const seats = await this.prisma.seating_arrangements.findMany({
      where: { hall_plans: { exam_id: examId } },
      include: {
        hall_plans: { include: { venues: true } },
        students: { select: STUDENT_SELECT },
      },
      orderBy: [{ hall_plan_id: 'asc' }, { seat_number: 'asc' }],
    });

    return {
      title: 'Seat allocation report',
      columns: [
        { header: 'Venue', key: 'venue', width: 20 },
        { header: 'Seat', key: 'seat_number', width: 8 },
        { header: 'Student', key: 'student', width: 24 },
        { header: 'Special accommodation', key: 'special', width: 12 },
      ],
      rows: seats.map((s) => ({
        venue: s.hall_plans.venues.name,
        seat_number: s.seat_number,
        student: studentName(s.students),
        special: s.is_special_accommodation ? 'Yes' : 'No',
      })),
    };
  }

  /** 4. INVIGILATOR DUTY — every invigilation duty for this exam. */
  async invigilatorDuty(examId: number): Promise<ReportTable> {
    await this.assertExamExists(examId);

    const duties = await this.prisma.invigilation_duties.findMany({
      where: { exam_id: examId },
      include: { faculty: true, hall_plans: { include: { venues: true } } },
      orderBy: [{ duty_date: 'asc' }, { session: 'asc' }],
    });

    return {
      title: 'Invigilator duty report',
      columns: [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Session', key: 'session', width: 10 },
        { header: 'Venue', key: 'venue', width: 20 },
        { header: 'Faculty', key: 'faculty', width: 24 },
        { header: 'Role', key: 'role', width: 10 },
      ],
      rows: duties.map((d) => ({
        date: toDate(d.duty_date),
        session: d.session,
        venue: d.hall_plans.venues.name,
        faculty: `${d.faculty.first_name} ${d.faculty.last_name}`,
        role: d.role,
      })),
    };
  }

  /** 5. MALPRACTICE — every incident recorded for this exam. */
  async malpractice(examId: number): Promise<ReportTable> {
    await this.assertExamExists(examId);

    const incidents = await this.prisma.malpractice_incidents.findMany({
      where: { exam_id: examId },
      include: { students: { select: STUDENT_SELECT }, venues: true },
      orderBy: { incident_date: 'asc' },
    });

    return {
      title: 'Malpractice report',
      columns: [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Student', key: 'student', width: 24 },
        { header: 'Venue', key: 'venue', width: 18 },
        { header: 'Seat', key: 'seat_number', width: 8 },
        { header: 'Nature', key: 'nature', width: 20 },
        { header: 'Action taken', key: 'action_taken', width: 20 },
      ],
      rows: incidents.map((i) => ({
        date: toDate(i.incident_date),
        student: studentName(i.students),
        venue: i.venues?.name ?? '',
        seat_number: i.seat_number ?? '',
        nature: i.nature,
        action_taken: i.action_taken,
      })),
    };
  }

  /** 6. RESULT ANALYSIS — pass rate per department, from the same computation as GET /exams/:id/results/pass-rate-by-department. */
  async resultAnalysis(examId: number): Promise<ReportTable> {
    const rates = await this.resultsService.getPassRateByDepartment(examId);

    return {
      title: 'Result analysis report',
      columns: [
        { header: 'Department', key: 'department_name', width: 24 },
        { header: 'Code', key: 'department_code', width: 10 },
        { header: 'Total papers', key: 'total_papers', width: 12 },
        { header: 'Pass %', key: 'pass_percentage', width: 10 },
      ],
      rows: rates,
    };
  }

  /** 7. RANK HOLDERS — same current-exam-GPA computation as GET /exams/:id/results/rank-holders. */
  async rankHolders(examId: number, limit = 10): Promise<ReportTable> {
    const holders = await this.resultsService.getRankHolders(examId, limit);

    return {
      title: 'Rank holders report',
      columns: [
        { header: 'Rank', key: 'rank', width: 6 },
        { header: 'Student', key: 'name', width: 24 },
        { header: 'Student ID', key: 'student_id_no', width: 14 },
        { header: 'Current-exam GPA', key: 'current_exam_gpa', width: 14 },
      ],
      rows: holders.map((h, i) => ({ rank: i + 1, ...h })),
    };
  }

  /** 8. REVALUATION — every revaluation request for this exam. */
  async revaluation(examId: number): Promise<ReportTable> {
    await this.assertExamExists(examId);

    const requests = await this.prisma.revaluation_requests.findMany({
      where: { exam_id: examId },
      include: {
        students: { select: STUDENT_SELECT },
        subjects: true,
        faculty: true,
      },
      orderBy: { requested_at: 'desc' },
    });

    return {
      title: 'Revaluation report',
      columns: [
        { header: 'Student', key: 'student', width: 24 },
        { header: 'Subject', key: 'subject', width: 20 },
        { header: 'Status', key: 'status', width: 14 },
        { header: 'Evaluator', key: 'evaluator', width: 20 },
        { header: 'Fee', key: 'fee_amount', width: 10 },
        { header: 'Requested', key: 'requested_at', width: 12 },
      ],
      rows: requests.map((r) => ({
        student: studentName(r.students),
        subject: r.subjects?.name ?? '',
        status: r.status,
        evaluator: r.faculty
          ? `${r.faculty.first_name} ${r.faculty.last_name}`
          : '',
        fee_amount: r.fee_amount ? Number(r.fee_amount) : 0,
        requested_at: toDate(r.requested_at),
      })),
    };
  }
}
