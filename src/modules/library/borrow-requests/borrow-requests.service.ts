import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { BorrowRecordsService } from '../borrow-records/borrow-records.service';
import { BorrowerType } from '../borrow-records/dto/create-borrow-record.dto';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

// book_borrow_requests (query.md, then widened for faculty/HoD) now exists
// as a real Prisma model — mirrors book_borrow_records' own borrower_type +
// nullable student_id/faculty_id pair rather than a bespoke shape.
const REQUEST_INCLUDE = {
  books: { select: { id: true, title: true, qr_code: true } },
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: { select: { first_name: true, last_name: true } },
    },
  },
  faculty: { select: { id: true, first_name: true, last_name: true } },
} satisfies Prisma.book_borrow_requestsInclude;

type RequestWithRelations = Prisma.book_borrow_requestsGetPayload<{
  include: typeof REQUEST_INCLUDE;
}>;

// Same soa_applications-first-then-fallback name resolution already used by
// BorrowRecordsService's formatRecord() — kept consistent rather than
// inventing a second name-lookup convention for the same domain.
function formatRequest(r: RequestWithRelations) {
  return {
    id: r.id,
    status: r.status,
    borrower_type: r.borrower_type,
    requested_at: r.requested_at,
    reviewed_at: r.reviewed_at,
    book: r.books
      ? { id: r.books.id, title: r.books.title, qr_code: r.books.qr_code }
      : null,
    student: r.students
      ? {
          id: r.students.id,
          student_id_no: r.students.student_id_no,
          name: r.students.soa_applications
            ? `${r.students.soa_applications.first_name} ${r.students.soa_applications.last_name ?? ''}`.trim()
            : `Student ${r.students.student_id_no}`,
        }
      : null,
    faculty: r.faculty
      ? {
          id: r.faculty.id,
          name: `${r.faculty.first_name} ${r.faculty.last_name}`,
        }
      : null,
  };
}

type CallerIdentity =
  { type: 'student'; id: number } | { type: 'faculty'; id: number };

@Injectable()
export class BorrowRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly borrowRecords: BorrowRecordsService,
  ) {}

  /**
   * Only 'student' resolves to a students row — every other role allowed
   * onto this controller (faculty, hod) resolves to the same faculty table
   * a HoD account already has a row in, matching the exact "anything that
   * isn't a self-service student is faculty" split BorrowRecordsService's
   * own create() already uses for the desk-issue path.
   */
  private async resolveCaller(
    currentUser: JwtPayload,
  ): Promise<CallerIdentity> {
    if (currentUser.role === 'student') {
      const student = await this.prisma.students.findUnique({
        where: { user_id: currentUser.sub },
      });
      if (!student) {
        throw new NotFoundException(
          'No student profile is linked to this account.',
        );
      }
      return { type: 'student', id: student.id };
    }

    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: currentUser.sub },
    });
    if (!faculty) {
      throw new NotFoundException(
        'No faculty profile is linked to this account.',
      );
    }
    return { type: 'faculty', id: faculty.id };
  }

  /** POST /me/library/borrow-requests — student or faculty/HoD self-service, always for their own account. */
  async create(bookId: number, currentUser: JwtPayload) {
    const caller = await this.resolveCaller(currentUser);

    const book = await this.prisma.books.findUnique({
      where: { id: bookId },
    });
    if (!book) {
      throw new NotFoundException('Book not found.');
    }

    try {
      const request = await this.prisma.book_borrow_requests.create({
        data: {
          book_id: bookId,
          borrower_type: caller.type,
          student_id: caller.type === 'student' ? caller.id : null,
          faculty_id: caller.type === 'faculty' ? caller.id : null,
        },
        include: REQUEST_INCLUDE,
      });
      return formatRequest(request);
    } catch (err) {
      // idx_book_borrow_requests_pending_unique_(student|faculty) — a
      // pending request for this book already exists for this caller.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictException(
          'You already have a pending request for this book.',
        );
      }
      throw err;
    }
  }

  /** GET /me/library/borrow-requests — the caller's own requests, any status. */
  async findMineForCaller(currentUser: JwtPayload) {
    const caller = await this.resolveCaller(currentUser);
    const rows = await this.prisma.book_borrow_requests.findMany({
      where:
        caller.type === 'student'
          ? { student_id: caller.id }
          : { faculty_id: caller.id },
      include: REQUEST_INCLUDE,
      orderBy: { requested_at: 'desc' },
    });
    return rows.map(formatRequest);
  }

  /**
   * GET /library/borrow-requests — Library/Admin queue. approval_status_enum
   * is declared pending|approved|rejected in that order, so ordering by
   * status ascending naturally puts every pending request first.
   */
  async findAllForStaff() {
    const rows = await this.prisma.book_borrow_requests.findMany({
      include: REQUEST_INCLUDE,
      orderBy: [{ status: 'asc' }, { requested_at: 'asc' }],
    });
    return rows.map(formatRequest);
  }

  private async findOrThrow(id: number) {
    const request = await this.prisma.book_borrow_requests.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException('Request not found.');
    }
    return request;
  }

  /**
   * PATCH /library/borrow-requests/:id/accept — Library/Admin only. Reuses
   * BorrowRecordsService.create() end-to-end (the librarian-issues-for-a-
   * student-or-faculty branch) instead of duplicating any of its checks —
   * overdue block, duplicate-borrow guard, per-student cap, and the atomic
   * available_copies decrement all apply exactly as they do for a direct
   * desk issue. If create() throws (no copies left, borrower now overdue,
   * etc.) the request is left pending rather than silently marked approved.
   */
  async accept(id: number, currentUser: JwtPayload) {
    const request = await this.findOrThrow(id);
    if (request.status !== 'pending') {
      throw new ConflictException('This request has already been reviewed.');
    }

    const record = await this.borrowRecords.create(
      {
        book_id: request.book_id,
        borrower_type: request.borrower_type as BorrowerType,
        student_id: request.student_id ?? undefined,
        faculty_id: request.faculty_id ?? undefined,
      },
      currentUser,
    );

    await this.prisma.book_borrow_requests.update({
      where: { id },
      data: {
        status: 'approved',
        reviewed_by_user_id: currentUser.sub,
        reviewed_at: new Date(),
        borrow_record_id: record.id,
      },
    });

    return record;
  }

  /** PATCH /library/borrow-requests/:id/reject — Library/Admin only. */
  async reject(id: number, currentUser: JwtPayload) {
    const request = await this.findOrThrow(id);
    if (request.status !== 'pending') {
      throw new ConflictException('This request has already been reviewed.');
    }

    await this.prisma.book_borrow_requests.update({
      where: { id },
      data: {
        status: 'rejected',
        reviewed_by_user_id: currentUser.sub,
        reviewed_at: new Date(),
      },
    });

    return { id, status: 'rejected' as const };
  }
}
