import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { ListExamRegistrationsQueryDto } from './dto/list-exam-registrations-query.dto';
import { CreateExamRegistrationDto } from './dto/create-exam-registration.dto';
import { ReviewExamRegistrationDto } from './dto/review-exam-registration.dto';
import { UpdateFeeStatusDto } from './dto/update-fee-status.dto';

const STUDENT_SELECT = {
  id: true,
  student_id_no: true,
  roll_no: true,
  register_no: true,
  class_id: true,
  soa_applications: { select: { first_name: true, last_name: true } },
  classes: {
    select: {
      current_semester: true,
      departments: { select: { id: true, code: true, name: true } },
    },
  },
} as const;

const INCLUDE = {
  students: { select: STUDENT_SELECT },
  exams: { select: { id: true, academic_year: true, semester: true, exam_category: true } },
} as const;

@Injectable()
export class ExamRegistrationsService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(query: ListExamRegistrationsQueryDto) {
    const where: Prisma.exam_registrationsWhereInput = {};
    if (query.exam_id) where.exam_id = query.exam_id;
    if (query.status) where.status = query.status;
    if (query.fee_status) where.fee_status = query.fee_status;

    const studentsWhere: Prisma.studentsWhereInput = {};
    if (query.department_id) {
      studentsWhere.class_id = { not: null };
      studentsWhere.classes = { department_id: query.department_id };
    }
    if (query.search) {
      studentsWhere.OR = [
        { student_id_no: { contains: query.search, mode: 'insensitive' } },
        { register_no: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (Object.keys(studentsWhere).length > 0) where.students = studentsWhere;

    const rows = await this.prisma.exam_registrations.findMany({
      where,
      include: INCLUDE,
      orderBy: { id: 'desc' },
    });
    if (rows.length === 0) return rows;

    // Courses: distinct subjects mapped for this exam+class (real exam_subject_mapping rows).
    const examIds = [...new Set(rows.map((r) => r.exam_id))];
    const classIds = [...new Set(rows.map((r) => r.students.class_id).filter((id): id is number => id != null))];
    const mappings = await this.prisma.exam_subject_mapping.findMany({
      where: { exam_id: { in: examIds }, class_id: { in: classIds } },
      select: { exam_id: true, class_id: true, subject_id: true },
      distinct: ['exam_id', 'class_id', 'subject_id'],
    });
    const coursesByExamClass = new Map<string, number>();
    for (const m of mappings) {
      const key = `${m.exam_id}:${m.class_id}`;
      coursesByExamClass.set(key, (coursesByExamClass.get(key) ?? 0) + 1);
    }

    // Arrears: how many arrear-category exams this student is registered for, across every cycle.
    const studentIds = [...new Set(rows.map((r) => r.student_id))];
    const arrearRegs = await this.prisma.exam_registrations.findMany({
      where: { student_id: { in: studentIds }, exams: { exam_category: 'arrear' } },
      select: { student_id: true },
    });
    const arrearsByStudent = new Map<number, number>();
    for (const r of arrearRegs) arrearsByStudent.set(r.student_id, (arrearsByStudent.get(r.student_id) ?? 0) + 1);

    return rows.map((r) => ({
      ...r,
      courses_count: r.students.class_id != null ? coursesByExamClass.get(`${r.exam_id}:${r.students.class_id}`) ?? 0 : 0,
      arrears_count: arrearsByStudent.get(r.student_id) ?? 0,
    }));
  }

  async getStats(examId?: number) {
    const where: Prisma.exam_registrationsWhereInput = examId ? { exam_id: examId } : {};
    const [total, approved, pending, rejected, feeUnpaid, feePartial, exam] = await Promise.all([
      this.prisma.exam_registrations.count({ where }),
      this.prisma.exam_registrations.count({ where: { ...where, status: 'approved' } }),
      this.prisma.exam_registrations.count({ where: { ...where, status: 'pending' } }),
      this.prisma.exam_registrations.count({ where: { ...where, status: 'rejected' } }),
      this.prisma.exam_registrations.count({ where: { ...where, fee_status: 'unpaid' } }),
      this.prisma.exam_registrations.count({ where: { ...where, fee_status: 'partial' } }),
      examId ? this.prisma.exams.findUnique({ where: { id: examId } }) : null,
    ]);

    const feePendingCount = feeUnpaid + feePartial;
    const closesAt = exam?.registration_closes_at ?? null;
    const daysToClose = closesAt ? Math.ceil((closesAt.getTime() - Date.now()) / 86_400_000) : null;

    return {
      registered: total,
      eligible: approved,
      pending_registrations: pending,
      rejected,
      fee_not_paid: feePendingCount,
      // Real per-candidate fee (query.md ALTER) × unpaid/partial count — null until that fee is set for this exam.
      fee_outstanding_amount: exam?.fee_amount != null ? Number(exam.fee_amount) * feePendingCount : null,
      registration_window_closes_in_days: daysToClose,
    };
  }

  async create(dto: CreateExamRegistrationDto) {
    const exam = await this.prisma.exams.findUnique({ where: { id: dto.exam_id } });
    if (!exam) throw new NotFoundException({ message: 'Exam not found.', errorCode: 'EXAM_NOT_FOUND' });

    const student = await this.prisma.students.findUnique({ where: { id: dto.student_id } });
    if (!student) throw new NotFoundException({ message: 'Student not found.', errorCode: 'STUDENT_NOT_FOUND' });

    const existing = await this.prisma.exam_registrations.findUnique({
      where: { exam_id_student_id: { exam_id: dto.exam_id, student_id: dto.student_id } },
    });
    if (existing) {
      throw new ConflictException({ message: 'This student is already registered for this exam.', errorCode: 'ALREADY_REGISTERED' });
    }

    return this.prisma.exam_registrations.create({
      data: { exam_id: dto.exam_id, student_id: dto.student_id, fee_status: dto.fee_status ?? 'unpaid' },
      include: INCLUDE,
    });
  }

  async review(id: number, dto: ReviewExamRegistrationDto, reviewedByUserId: number) {
    const existing = await this.prisma.exam_registrations.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Registration not found.', errorCode: 'REGISTRATION_NOT_FOUND' });

    return this.prisma.exam_registrations.update({
      where: { id },
      data: { status: dto.status, approved_by_user_id: reviewedByUserId, approved_at: new Date() },
      include: INCLUDE,
    });
  }

  async updateFeeStatus(id: number, dto: UpdateFeeStatusDto) {
    const existing = await this.prisma.exam_registrations.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException({ message: 'Registration not found.', errorCode: 'REGISTRATION_NOT_FOUND' });

    return this.prisma.exam_registrations.update({
      where: { id },
      data: { fee_status: dto.fee_status },
      include: INCLUDE,
    });
  }
}
