import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

export type LibraryStatusFilter = 'all' | 'available' | 'partial' | 'out';

@Injectable()
export class PrincipalLibraryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /me/principal/facilities/library/summary
   *
   * No "footfalls today" figure: no gate/visit-log table exists for the
   * library anywhere in this schema. `e_resources` is real but only holds
   * catalogue entries (a handful of rows) — there's no usage/download
   * counter that would produce a large aggregate figure, so this reports
   * the real catalogue count, not an invented "14,860"-style number.
   */
  async summary() {
    const [books, borrowedCount, eResourcesCount] = await Promise.all([
      this.prisma.books.findMany({
        where: { deleted_at: null },
        select: { total_copies: true },
      }),
      this.prisma.book_borrow_records.count({ where: { status: 'borrowed' } }),
      this.prisma.e_resources.count(),
    ]);

    return {
      distinct_titles: books.length,
      total_copies: books.reduce((sum, b) => sum + b.total_copies, 0),
      borrowed: borrowedCount,
      e_resources_count: eResourcesCount,
    };
  }

  /** GET /me/principal/facilities/library/books?status=&q= */
  async list(status: LibraryStatusFilter, q?: string) {
    const books = await this.prisma.books.findMany({
      where: { deleted_at: null },
      select: {
        id: true,
        title: true,
        author: true,
        qr_code: true,
        total_copies: true,
        available_copies: true,
        book_categories: { select: { name: true } },
      },
      orderBy: { title: 'asc' },
    });

    const withStatus = books.map((b) => {
      const borrowed = b.total_copies - b.available_copies;
      let statusLabel: 'available' | 'partial' | 'out';
      if (b.available_copies <= 0) statusLabel = 'out';
      else if (b.available_copies < b.total_copies) statusLabel = 'partial';
      else statusLabel = 'available';

      return {
        id: b.id,
        title: b.title,
        author: b.author,
        accession: b.qr_code,
        category: b.book_categories.name,
        total_copies: b.total_copies,
        borrowed,
        available: b.available_copies,
        status: statusLabel,
      };
    });

    let filtered = withStatus;
    if (status !== 'all') {
      filtered = filtered.filter((b) => b.status === status);
    }
    if (q) {
      const needle = q.toLowerCase();
      filtered = filtered.filter((b) =>
        [b.title, b.author, b.category, b.accession]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(needle),
      );
    }

    return { total: filtered.length, books: filtered };
  }
}
