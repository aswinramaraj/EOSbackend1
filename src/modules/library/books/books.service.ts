import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { SearchBooksDto } from './dto/search-books.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import type { Prisma } from 'generated/prisma/client';
import { CreateBookDto } from './dto/create-book.dto';
import { UpdateBookDto } from './dto/update-book.dto';

// Minimum trigram/word similarity score for a row to count as a fuzzy match.
const FUZZY_SIMILARITY_THRESHOLD = 0.2;

interface BookFuzzySearchRow {
  id: number;
  qr_code: string;
  title: string;
  author: string | null;
  isbn: string | null;
  publisher: string | null;
  edition: string | null;
  category_id: number;
  category_name: string;
  department_id: number | null;
  department_name: string | null;
  department_code: string | null;
  rack_id: number | null;
  rack_code: string | null;
  total_copies: number;
  available_copies: number;
  price_per_copy: string | null;
  vendor_fund: string | null;
  similarity: number;
}

const BOOK_INCLUDE = {
  book_categories: {
    select: { id: true, name: true },
  },
  departments: {
    select: { id: true, name: true, code: true },
  },
  library_racks: {
    select: { id: true, rack_code: true, subject_range: true },
  },
} satisfies Prisma.booksInclude;

type BookWithRelations = Prisma.booksGetPayload<{
  include: typeof BOOK_INCLUDE;
}>;

function toBookResponse(book: BookWithRelations) {
  return {
    id: book.id,
    qr_code: book.qr_code,
    title: book.title,
    author: book.author,
    isbn: book.isbn,
    publisher: book.publisher,
    edition: book.edition,
    category_id: book.category_id,
    category_name: book.book_categories.name,
    department: book.departments
      ? {
          id: book.departments.id,
          name: book.departments.name,
          code: book.departments.code,
        }
      : null,
    rack: book.library_racks
      ? {
          id: book.library_racks.id,
          rack_code: book.library_racks.rack_code,
          subject_range: book.library_racks.subject_range,
        }
      : null,
    total_copies: book.total_copies,
    available_copies: book.available_copies,
    price_per_copy:
      book.price_per_copy !== null ? Number(book.price_per_copy) : null,
    vendor_fund: book.vendor_fund,
  };
}

@Injectable()
export class BooksService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateBookDto) {
    if (
      dto.available_copies !== undefined &&
      dto.available_copies > dto.total_copies
    ) {
      throw new BadRequestException(
        'available_copies cannot exceed total_copies.',
      );
    }

    // Same title + author + edition already catalogued? Add to its copies
    // instead of creating a duplicate entry for the same book — but two
    // different editions of the same title/author must stay separate rows.
    const existingBook = await this.prisma.books.findFirst({
      where: {
        title: { equals: dto.title, mode: 'insensitive' },
        author: dto.author ? { equals: dto.author, mode: 'insensitive' } : null,
        edition: dto.edition
          ? { equals: dto.edition, mode: 'insensitive' }
          : null,
        deleted_at: null,
      },
      include: BOOK_INCLUDE,
    });

    if (existingBook) {
      const updated = await this.prisma.books.update({
        where: {
          id: existingBook.id,
        },
        data: {
          total_copies: {
            increment: dto.total_copies,
          },
          available_copies: {
            increment: dto.available_copies ?? dto.total_copies,
          },
        },
        include: BOOK_INCLUDE,
      });

      return toBookResponse(updated);
    }

    // Check whether QR code already exists
    const existingQrCode = await this.prisma.books.findUnique({
      where: {
        qr_code: dto.qr_code,
      },
    });

    if (existingQrCode) {
      throw new ConflictException('Book with this QR code already exists.');
    }

    // Check whether category exists
    const category = await this.prisma.book_categories.findUnique({
      where: {
        id: dto.category_id,
      },
    });

    if (!category) {
      throw new NotFoundException('Book category not found.');
    }

    // Check whether department exists (if given)
    if (dto.department_id) {
      const department = await this.prisma.departments.findUnique({
        where: { id: dto.department_id },
      });

      if (!department) {
        throw new NotFoundException('Department not found.');
      }
    }

    // Check whether rack exists (if given)
    if (dto.rack_id) {
      const rack = await this.prisma.library_racks.findUnique({
        where: { id: dto.rack_id },
      });

      if (!rack) {
        throw new NotFoundException('Rack not found.');
      }
    }

    // Create the book
    const book = await this.prisma.books.create({
      data: {
        qr_code: dto.qr_code,
        title: dto.title,
        author: dto.author,
        isbn: dto.isbn,
        publisher: dto.publisher,
        edition: dto.edition,
        category_id: dto.category_id,
        department_id: dto.department_id,
        rack_id: dto.rack_id,
        total_copies: dto.total_copies,
        available_copies: dto.available_copies ?? dto.total_copies,
        price_per_copy: dto.price_per_copy,
        vendor_fund: dto.vendor_fund,
      },
      include: BOOK_INCLUDE,
    });

    return toBookResponse(book);
  }

  async findAll(searchDto: SearchBooksDto) {
    const {
      q,
      category_id,
      department_id,
      rack_id,
      available_only = false,
      page = 1,
      page_size = 20,
    } = searchDto;

    const where: Prisma.booksWhereInput = { deleted_at: null };

    if (q) {
      where.OR = [
        {
          title: {
            contains: q,
            mode: 'insensitive',
          },
        },
        {
          author: {
            contains: q,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (category_id) {
      where.category_id = category_id;
    }

    if (department_id) {
      where.department_id = department_id;
    }

    if (rack_id) {
      where.rack_id = rack_id;
    }

    if (available_only) {
      where.available_copies = {
        gt: 0,
      };
    }

    const [books, total] = await this.prisma.$transaction([
      this.prisma.books.findMany({
        where,

        include: BOOK_INCLUDE,

        orderBy: {
          title: 'asc',
        },

        skip: (page - 1) * page_size,

        take: page_size,
      }),

      this.prisma.books.count({
        where,
      }),
    ]);

    return {
      page,
      page_size,
      total,

      data: books.map(toBookResponse),
    };
  }

  /**
   * Typo-tolerant search over title/author using pg_trgm's similarity() and
   * word_similarity(). word_similarity matches the query against the best
   * substring of the target, so short/partial queries (e.g. "computr")
   * still score well against long titles ("Computer Science Engineering").
   */
  async searchFuzzy(query: string, limit = 20) {
    const q = query.trim();
    const cappedLimit = Math.min(limit ?? 20, 20);

    const rows = await this.prisma.$queryRaw<BookFuzzySearchRow[]>`
      SELECT
        b.id,
        b.qr_code,
        b.title,
        b.author,
        b.isbn,
        b.publisher,
        b.edition,
        b.category_id,
        bc.name AS category_name,
        b.department_id,
        d.name AS department_name,
        d.code AS department_code,
        b.rack_id,
        r.rack_code,
        b.total_copies,
        b.available_copies,
        b.price_per_copy,
        b.vendor_fund,
        GREATEST(
          similarity(b.title, ${q}),
          word_similarity(${q}, b.title),
          COALESCE(word_similarity(${q}, b.author), 0)
        ) AS similarity
      FROM books b
      JOIN book_categories bc ON bc.id = b.category_id
      LEFT JOIN departments d ON d.id = b.department_id
      LEFT JOIN library_racks r ON r.id = b.rack_id
      WHERE
        b.deleted_at IS NULL
        AND (
          similarity(b.title, ${q}) > ${FUZZY_SIMILARITY_THRESHOLD}
          OR word_similarity(${q}, b.title) > ${FUZZY_SIMILARITY_THRESHOLD}
          OR (b.author IS NOT NULL AND word_similarity(${q}, b.author) > ${FUZZY_SIMILARITY_THRESHOLD})
        )
      ORDER BY similarity DESC
      LIMIT ${cappedLimit}
    `;

    return rows.map((row) => ({
      id: row.id,
      qr_code: row.qr_code,
      title: row.title,
      author: row.author,
      isbn: row.isbn,
      publisher: row.publisher,
      edition: row.edition,
      category_id: row.category_id,
      category_name: row.category_name,
      department: row.department_id
        ? {
            id: row.department_id,
            name: row.department_name,
            code: row.department_code,
          }
        : null,
      rack: row.rack_id ? { id: row.rack_id, rack_code: row.rack_code } : null,
      total_copies: row.total_copies,
      available_copies: row.available_copies,
      price_per_copy:
        row.price_per_copy !== null ? Number(row.price_per_copy) : null,
      vendor_fund: row.vendor_fund,
      similarity: Number(row.similarity),
    }));
  }

  async findOne(id: number) {
    const book = await this.prisma.books.findUnique({
      where: {
        id,
      },
      include: BOOK_INCLUDE,
    });

    if (!book || book.deleted_at) {
      throw new NotFoundException('Book not found.');
    }

    return toBookResponse(book);
  }

  async update(id: number, dto: UpdateBookDto) {
    const book = await this.prisma.books.findUnique({
      where: { id },
    });

    if (!book || book.deleted_at) {
      throw new NotFoundException('Book not found.');
    }

    const effectiveTotal = dto.total_copies ?? book.total_copies;
    if (
      dto.available_copies !== undefined &&
      dto.available_copies > effectiveTotal
    ) {
      throw new BadRequestException(
        'available_copies cannot exceed total_copies.',
      );
    }

    // QR validation
    if (dto.qr_code) {
      const existing = await this.prisma.books.findFirst({
        where: {
          qr_code: dto.qr_code,
          NOT: {
            id,
          },
        },
      });

      if (existing) {
        throw new ConflictException('Book with this QR code already exists.');
      }
    }

    // Category validation
    if (dto.category_id) {
      const category = await this.prisma.book_categories.findUnique({
        where: {
          id: dto.category_id,
        },
      });

      if (!category) {
        throw new NotFoundException('Book category not found.');
      }
    }

    // Department validation
    if (dto.department_id) {
      const department = await this.prisma.departments.findUnique({
        where: { id: dto.department_id },
      });

      if (!department) {
        throw new NotFoundException('Department not found.');
      }
    }

    // Rack validation
    if (dto.rack_id) {
      const rack = await this.prisma.library_racks.findUnique({
        where: { id: dto.rack_id },
      });

      if (!rack) {
        throw new NotFoundException('Rack not found.');
      }
    }

    const updated = await this.prisma.books.update({
      where: { id },
      data: dto,
      include: BOOK_INCLUDE,
    });

    return toBookResponse(updated);
  }

  async remove(id: number) {
    // Check whether book exists
    const book = await this.prisma.books.findUnique({
      where: {
        id,
      },
    });

    if (!book || book.deleted_at) {
      throw new NotFoundException('Book not found.');
    }

    // Check if the book is currently borrowed
    const borrowed = await this.prisma.book_borrow_records.findFirst({
      where: {
        book_id: id,
        status: 'borrowed',
      },
    });

    if (borrowed) {
      throw new ConflictException(
        'Cannot delete a book that is currently borrowed.',
      );
    }

    // Soft delete: book_borrow_records.book_id -> books.id has no cascade
    // (onDelete: NoAction), so a hard delete would fail on FK constraint for
    // any book with return history — and that history (fines, damage
    // charges) feeds real reports (see reports.service.ts), so it can't just
    // be deleted alongside the book. Marking the book deleted_at + zeroing
    // available_copies removes it from listings/search (see findAll/
    // searchFuzzy) and blocks new borrows via the existing atomic
    // available_copies > 0 check in borrow-records.service.ts, without
    // touching borrow/return logic or any other module.
    await this.prisma.books.update({
      where: { id },
      data: {
        deleted_at: new Date(),
        available_copies: 0,
      },
    });

    return {
      message: 'Book deleted successfully.',
    };
  }
}
