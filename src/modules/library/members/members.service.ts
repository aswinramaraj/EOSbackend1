import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { SearchMembersDto } from './dto/search-members.dto';

function startOfDay(date: Date | string) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

const MEMBER_SELECT = {
  id: true,
  student_id_no: true,
  register_no: true,
  soa_applications: {
    select: { first_name: true, last_name: true },
  },
  courses: {
    select: {
      departments: {
        select: { id: true, name: true, code: true },
      },
    },
  },
  book_borrow_records: {
    select: {
      status: true,
      due_date: true,
      borrowed_date: true,
      books: { select: { title: true } },
    },
    orderBy: { borrowed_date: 'desc' as const },
  },
} satisfies Prisma.studentsSelect;

type MemberRow = Prisma.studentsGetPayload<{ select: typeof MEMBER_SELECT }>;

function toMemberSummary(student: MemberRow) {
  const records = student.book_borrow_records;
  const currentlyBorrowed = records.filter(
    (r) => r.status === 'borrowed',
  ).length;
  const hasOverdue = records.some(
    (r) =>
      r.status === 'borrowed' &&
      startOfDay(r.due_date) < startOfDay(new Date()),
  );
  const last = records[0] ?? null;

  return {
    id: student.id,
    student_id_no: student.student_id_no,
    register_no: student.register_no,
    name: student.soa_applications
      ? `${student.soa_applications.first_name} ${student.soa_applications.last_name ?? ''}`.trim()
      : `Student ${student.student_id_no}`,
    department: student.courses.departments,
    currently_borrowed: currentlyBorrowed,
    total_borrowed: records.length,
    last_borrowed: last
      ? { title: last.books.title, date: last.borrowed_date }
      : null,
    // No fine-threshold config exists yet (that's Settings/large-scope
    // pending work) so there's no 'blocked' tier here — just whether they
    // currently hold anything overdue.
    library_status: hasOverdue ? 'overdue' : 'clear',
  };
}

@Injectable()
export class MembersService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * "Library members" isn't a real table — it's every student who has
   * borrowed at least once, with stats rolled up from their borrow records.
   */
  async findAll(dto: SearchMembersDto) {
    const { q, department_id, page = 1, page_size = 20 } = dto;

    const where: Prisma.studentsWhereInput = {
      book_borrow_records: { some: {} },
    };

    if (department_id) {
      where.courses = { department_id };
    }

    if (q) {
      where.OR = [
        { student_id_no: { contains: q, mode: 'insensitive' } },
        { register_no: { contains: q, mode: 'insensitive' } },
        { roll_no: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [students, total] = await this.prisma.$transaction([
      this.prisma.students.findMany({
        where,
        select: MEMBER_SELECT,
        orderBy: { student_id_no: 'asc' },
        skip: (page - 1) * page_size,
        take: page_size,
      }),
      this.prisma.students.count({ where }),
    ]);

    return {
      page,
      page_size,
      total,
      data: students.map(toMemberSummary),
    };
  }
}
