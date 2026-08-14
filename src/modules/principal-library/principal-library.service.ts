import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { Prisma } from '../../../generated/prisma/client';

interface TotalsRow {
  total_books: bigint;
  borrowed_books: bigint;
  overdue_books: bigint;
}
interface CategoryRow {
  id: number;
  name: string;
  total_copies: bigint;
  borrowed: bigint;
  overdue: bigint;
}

/**
 * Principal-only Library overview. "Borrowed" counts currently-open loans
 * (book_borrow_records.status IN ('borrowed','overdue')), not all-time
 * borrow events. "Available" is derived as total - borrowed rather than
 * trusting books.available_copies directly, so the category breakdown
 * always reconciles with the same borrowed count shown for it.
 */
@Injectable()
export class PrincipalLibraryService {
  private readonly logger = new Logger(PrincipalLibraryService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getOverview() {
    try {
      // Sequential, not Promise.all - see principal-faculty/principal-departments
      // services for why (Supabase session-mode pool is small and shared).
      const totalsRows = await this.prisma.$queryRaw<TotalsRow[]>(Prisma.sql`
        SELECT
          (SELECT COALESCE(SUM(total_copies), 0) FROM books WHERE deleted_at IS NULL)::bigint AS total_books,
          (SELECT COUNT(*) FROM book_borrow_records WHERE status IN ('borrowed', 'overdue'))::bigint AS borrowed_books,
          (SELECT COUNT(*) FROM book_borrow_records WHERE status = 'overdue')::bigint AS overdue_books
      `);

      const categoryRows = await this.prisma.$queryRaw<CategoryRow[]>(Prisma.sql`
        SELECT bc.id, bc.name,
          (SELECT COALESCE(SUM(b.total_copies), 0) FROM books b WHERE b.category_id = bc.id AND b.deleted_at IS NULL)::bigint AS total_copies,
          (
            SELECT COUNT(*) FROM book_borrow_records bbr
            JOIN books b2 ON b2.id = bbr.book_id
            WHERE b2.category_id = bc.id AND bbr.status IN ('borrowed', 'overdue')
          )::bigint AS borrowed,
          (
            SELECT COUNT(*) FROM book_borrow_records bbr
            JOIN books b3 ON b3.id = bbr.book_id
            WHERE b3.category_id = bc.id AND bbr.status = 'overdue'
          )::bigint AS overdue
        FROM book_categories bc
        WHERE EXISTS (SELECT 1 FROM books b WHERE b.category_id = bc.id AND b.deleted_at IS NULL)
        ORDER BY bc.name ASC
      `);

      const totals = totalsRows[0];
      const totalBooks = Number(totals?.total_books ?? 0);
      const borrowedBooks = Number(totals?.borrowed_books ?? 0);

      return {
        total_books: totalBooks,
        borrowed_books: borrowedBooks,
        available_books: Math.max(totalBooks - borrowedBooks, 0),
        overdue_books: Number(totals?.overdue_books ?? 0),
        categories: categoryRows.map((cat) => {
          const total = Number(cat.total_copies);
          const borrowed = Number(cat.borrowed);
          return {
            id: cat.id,
            name: cat.name,
            total_copies: total,
            borrowed,
            available: Math.max(total - borrowed, 0),
            overdue: Number(cat.overdue),
          };
        }),
      };
    } catch (err) {
      this.logger.error('DB error computing principal library overview', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
