import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

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
export class HallTicketsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /hall-tickets/count — total real tickets ever generated, across every exam. Used only for the sidebar nav badge. */
  async countAll() {
    return this.prisma.hall_tickets.count();
  }

  /** GET /hall-tickets?exam_id= — every hall ticket generated for an exam, plus every registered-but-not-yet-generated student (shown as "not generated") so the design's full roster view works off real registrations. */
  async findAllForExam(examId: number) {
    const [tickets, registrations] = await Promise.all([
      this.prisma.hall_tickets.findMany({ where: { exam_id: examId }, include: { students: { select: STUDENT_SELECT } } }),
      this.prisma.exam_registrations.findMany({
        where: { exam_id: examId, status: 'approved' },
        include: { students: { select: STUDENT_SELECT } },
      }),
    ]);

    const ticketByStudent = new Map(tickets.map((t) => [t.student_id, t]));

    return registrations.map((r) => {
      const ticket = ticketByStudent.get(r.student_id);
      return {
        student: r.students,
        fee_status: r.fee_status,
        hall_ticket: ticket
          ? {
              id: ticket.id,
              file_url: ticket.file_url,
              generated_at: ticket.generated_at,
              downloaded_at: ticket.downloaded_at,
              mismatch_reported: ticket.mismatch_reported,
              mismatch_note: ticket.mismatch_note,
            }
          : null,
      };
    });
  }

  async markDownloaded(examId: number, studentId: number) {
    const ticket = await this.prisma.hall_tickets.findUnique({
      where: { exam_id_student_id: { exam_id: examId, student_id: studentId } },
    });
    if (!ticket) {
      throw new NotFoundException({ message: 'Hall ticket not found for this exam and student', errorCode: 'HALL_TICKET_NOT_FOUND' });
    }

    return this.prisma.hall_tickets.update({
      where: { id: ticket.id },
      data: { downloaded_at: ticket.downloaded_at ?? new Date() },
    });
  }

  async reportMismatch(examId: number, studentId: number, note: string) {
    const ticket = await this.prisma.hall_tickets.findUnique({
      where: { exam_id_student_id: { exam_id: examId, student_id: studentId } },
    });
    if (!ticket) {
      throw new NotFoundException({ message: 'Hall ticket not found for this exam and student', errorCode: 'HALL_TICKET_NOT_FOUND' });
    }

    return this.prisma.hall_tickets.update({
      where: { id: ticket.id },
      data: { mismatch_reported: true, mismatch_note: note },
    });
  }

  async generate(examId: number, studentId: number) {
    const exam = await this.prisma.exams.findUnique({ where: { id: examId } });
    if (!exam) {
      throw new NotFoundException({
        message: 'Exam not found',
        errorCode: 'EXAM_NOT_FOUND',
      });
    }

    const student = await this.prisma.students.findUnique({
      where: { id: studentId },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const publishedSlot = await this.prisma.exam_timetable.findFirst({
      where: {
        exam_subject_mapping: { exam_id: examId, is_published: true },
      },
    });
    if (!publishedSlot) {
      throw new UnprocessableEntityException({
        message: 'The exam timetable has not been published yet',
        errorCode: 'TIMETABLE_NOT_PUBLISHED',
      });
    }

    const existing = await this.prisma.hall_tickets.findUnique({
      where: { exam_id_student_id: { exam_id: examId, student_id: studentId } },
    });
    if (existing) {
      throw new ConflictException({
        message:
          'Hall ticket has already been generated for this student and exam',
        errorCode: 'ALREADY_GENERATED',
      });
    }

    return this.prisma.hall_tickets.create({
      data: {
        exam_id: examId,
        student_id: studentId,
        file_url: `/documents/hall-tickets/${studentId}_${examId}.pdf`,
      },
    });
  }

  /** Real per-course schedule for one student's hall ticket preview: date/session/course from exam_timetable, hall/seat from real seating_arrangements when allocated. */
  async getSchedule(examId: number, studentId: number) {
    const student = await this.prisma.students.findUnique({ where: { id: studentId }, select: { class_id: true } });
    if (!student?.class_id) return [];

    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: examId, class_id: student.class_id },
      include: { subjects: { select: { subject_code: true, name: true } } },
    });
    if (mappings.length === 0) return [];

    const timetable = await this.prisma.exam_timetable.findMany({
      where: { exam_subject_mapping_id: { in: mappings.map((m) => m.id) } },
      orderBy: [{ exam_date: 'asc' }],
    });

    const seating = await this.prisma.seating_arrangements.findMany({
      where: { student_id: studentId },
      include: { hall_plans: { select: { exam_id: true, exam_date: true, venues: { select: { name: true } } } } },
    });
    const seatByDate = new Map(
      seating.filter((s) => s.hall_plans.exam_id === examId).map((s) => [s.hall_plans.exam_date.toISOString().slice(0, 10), s]),
    );

    const mappingById = new Map(mappings.map((m) => [m.id, m]));
    return timetable.map((t) => {
      const mapping = mappingById.get(t.exam_subject_mapping_id)!;
      const seat = seatByDate.get(t.exam_date.toISOString().slice(0, 10));
      return {
        date: t.exam_date.toISOString().slice(0, 10),
        session: t.session,
        subject_code: mapping.subjects.subject_code,
        subject_name: mapping.subjects.name,
        hall: seat?.hall_plans.venues.name ?? null,
        seat: seat?.seat_number ?? null,
      };
    });
  }

  async findOne(examId: number, studentId: number) {
    const hallTicket = await this.prisma.hall_tickets.findUnique({
      where: { exam_id_student_id: { exam_id: examId, student_id: studentId } },
    });

    if (!hallTicket) {
      throw new NotFoundException({
        message: 'Hall ticket not found for this exam and student',
        errorCode: 'HALL_TICKET_NOT_FOUND',
      });
    }

    return hallTicket;
  }
}
