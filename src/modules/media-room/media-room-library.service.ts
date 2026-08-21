import { BadRequestException, ForbiddenException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

const MAX_RENEWALS = 2;
const LOAN_DAYS = 14;

/**
 * Staff library loans — the real, pre-existing `book_borrow_records` table
 * (in schema.prisma). `borrower_type_enum` gained a `staff` value alongside
 * `student`/`faculty` in a later migration, with a matching `staff_user_id`
 * column — exactly the generic non-teaching-staff path this needs. No new
 * table, and nothing here touches the institution's real student/faculty
 * borrowing records except by sharing the same `books` inventory.
 */
@Injectable()
export class MediaRoomLibraryService {
  private readonly logger = new Logger(MediaRoomLibraryService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: {
    id: number;
    borrowed_date: Date;
    due_date: Date;
    returned_date: Date | null;
    status: string;
    renewal_count: number;
    fine_paid_amount: unknown;
    books: { id: number; title: string; qr_code: string; author: string | null };
  }) {
    return {
      id: row.id,
      book: row.books,
      borrowed_date: row.borrowed_date,
      due_date: row.due_date,
      returned_date: row.returned_date,
      status: row.status,
      renewal_count: row.renewal_count,
      is_overdue: row.status === 'borrowed' && row.due_date < new Date(),
      fine_amount: row.fine_paid_amount != null ? Number(row.fine_paid_amount) : 0,
    };
  }

  async findOverview(userId: number) {
    try {
      const rows = await this.prisma.book_borrow_records.findMany({
        where: { staff_user_id: userId, borrower_type: 'staff' },
        include: { books: { select: { id: true, title: true, qr_code: true, author: true } } },
        orderBy: { borrowed_date: 'desc' },
      });
      const withBooks = rows.map((r) => this.toResponse(r));
      return {
        ready: true,
        card_no: `STAFF-${userId}`,
        max_renewals: MAX_RENEWALS,
        borrowed: withBooks.filter((r) => r.status === 'borrowed'),
        history: withBooks.filter((r) => r.status !== 'borrowed'),
      };
    } catch (err) {
      this.logger.error('DB error listing library loans', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async requestBook(bookId: number, userId: number) {
    const book = await this.prisma.books.findUnique({ where: { id: bookId } });
    if (!book) throw new NotFoundException({ message: 'Book not found', errorCode: 'BOOK_NOT_FOUND' });
    if (book.available_copies <= 0) {
      throw new BadRequestException({ message: 'No copies available to issue', errorCode: 'NO_COPIES_AVAILABLE' });
    }

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + LOAN_DAYS);

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.books.update({ where: { id: bookId }, data: { available_copies: { decrement: 1 } } });
        const row = await tx.book_borrow_records.create({
          data: { book_id: bookId, borrower_type: 'staff', staff_user_id: userId, due_date: dueDate },
          include: { books: { select: { id: true, title: true, qr_code: true, author: true } } },
        });
        return this.toResponse(row);
      });
    } catch (err) {
      // The DB's book_borrow_records_check constraint still only allows
      // borrower_type IN ('student','faculty') on some environments — the
      // fix (prisma/manual-sql/fix_book_borrow_records_staff_check.sql) adds
      // the 'staff' branch, but until it's run, surface this honestly
      // instead of a generic 500.
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('book_borrow_records_check')) {
        this.logger.error('book_borrow_records_check does not yet permit borrower_type=staff — run fix_book_borrow_records_staff_check.sql', err);
        throw new InternalServerErrorException({
          message: 'Staff library borrowing is not enabled on this database yet — ask an admin to run the pending migration.',
          errorCode: 'STAFF_BORROWING_NOT_MIGRATED',
        });
      }
      this.logger.error('DB error requesting library book', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async renew(loanId: number, userId: number) {
    const loan = await this.prisma.book_borrow_records.findUnique({
      where: { id: loanId },
      include: { books: { select: { id: true, title: true, qr_code: true, author: true } } },
    });
    if (!loan) throw new NotFoundException({ message: 'Loan not found', errorCode: 'LOAN_NOT_FOUND' });
    if (loan.staff_user_id !== userId) throw new ForbiddenException({ message: 'Not your loan', errorCode: 'NOT_OWNER' });
    if (loan.due_date < new Date()) throw new BadRequestException({ message: 'Overdue books cannot be renewed', errorCode: 'LOAN_OVERDUE' });
    if (loan.renewal_count >= MAX_RENEWALS) throw new BadRequestException({ message: 'Renewal limit reached', errorCode: 'RENEWAL_LIMIT_REACHED' });

    try {
      const newDueDate = new Date(loan.due_date);
      newDueDate.setDate(newDueDate.getDate() + LOAN_DAYS);
      const updated = await this.prisma.book_borrow_records.update({
        where: { id: loanId },
        data: { due_date: newDueDate, renewal_count: { increment: 1 }, last_renewed_at: new Date() },
        include: { books: { select: { id: true, title: true, qr_code: true, author: true } } },
      });
      return this.toResponse(updated);
    } catch (err) {
      this.logger.error(`DB error renewing library loan ${loanId}`, err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }
}
