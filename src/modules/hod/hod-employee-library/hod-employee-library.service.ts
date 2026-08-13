import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ROLES } from 'src/common/constants/roles.constant';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { BorrowRecordsService } from 'src/modules/library/borrow-records/borrow-records.service';
import { LibrarySettingsService } from 'src/modules/library/settings/settings.service';
import { BorrowRecordAction } from 'src/modules/library/borrow-records/dto/update-borrow-record.dto';
import { BorrowerType } from 'src/modules/library/borrow-records/dto/create-borrow-record.dto';

const FETCH_PAGE_SIZE = 100;

@Injectable()
export class HodEmployeeLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly borrowRecordsService: BorrowRecordsService,
    private readonly librarySettings: LibrarySettingsService,
  ) {}

  private async resolveFaculty(userId: number) {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
      select: { id: true, departments: { select: { code: true } } },
    });
    if (!faculty) {
      throw new NotFoundException(
        'Faculty profile not found for the authenticated user',
      );
    }
    return faculty;
  }

  // Deliberately role: FACULTY, not HOD — BorrowRecordsService.findAll/
  // findOne only self-scope to the caller's own records when role is
  // exactly 'faculty' (an 'hod' caller would otherwise see every borrower's
  // records, library-wide). userId is always the real, server-resolved
  // caller id, never client-supplied.
  private facultyUser(userId: number): JwtPayload {
    return { sub: userId, role: ROLES.FACULTY, email: '', roleId: 0 };
  }

  /** GET /hod/employee/library — the HOD's own borrowing, as a faculty member (self-service), not the librarian's view of everyone. */
  async getOverview(userId: number) {
    const faculty = await this.resolveFaculty(userId);
    const currentUser = this.facultyUser(userId);

    const [rules, result] = await Promise.all([
      this.librarySettings.getRules(),
      this.borrowRecordsService.findAll(
        { page: 1, page_size: FETCH_PAGE_SIZE },
        currentUser,
      ),
    ]);

    // formatRecord() (inside BorrowRecordsService) doesn't select
    // books.author — every other consumer of that shared include only
    // needs title/qr_code, so it's fetched separately here rather than
    // widening a shape other callers depend on.
    const bookIds = [...new Set(result.data.map((r) => r.book.id))];
    const authors = bookIds.length
      ? await this.prisma.books.findMany({
          where: { id: { in: bookIds } },
          select: { id: true, author: true },
        })
      : [];
    const authorById = new Map(authors.map((b) => [b.id, b.author]));

    const records = result.data.map((r) => ({
      ...r,
      book: { ...r.book, author: authorById.get(r.book.id) ?? null },
    }));

    return {
      // Display-only card number synthesized from real id fields — same
      // pattern already used for APR-*/PSL-* reference numbers elsewhere —
      // there's no dedicated library-card-number column on faculty.
      card_no: `EMP-${faculty.departments.code}-${String(faculty.id).padStart(4, '0')}`,
      books_per_student: rules.booksPerStudent,
      max_renewals: rules.maxRenewals,
      borrowed: records.filter((r) => r.status === 'borrowed'),
      history: records.filter((r) => r.status !== 'borrowed'),
    };
  }

  /** PATCH /hod/employee/library/:id/renew */
  async renew(userId: number, id: number) {
    const currentUser = this.facultyUser(userId);
    // update() itself (below) has no ownership check at all — it's normally
    // a librarian-only action — so ownership is confirmed here first via
    // findOne(), which 404s on any record that isn't the caller's own.
    await this.borrowRecordsService.findOne(id, currentUser);
    return this.borrowRecordsService.update(id, {
      action: BorrowRecordAction.renew,
    });
  }

  /**
   * POST /hod/employee/library/request — same self-issue mechanism the
   * shared library controller already exposes to students
   * (POST /library/borrow-records), called here directly so it can run
   * under the caller's own real faculty_id without needing that route's
   * own @Roles guard (student/library/admin) opened up to hod — every
   * existing business rule inside create() (overdue block, duplicate
   * check, copies availability) still applies unchanged.
   */
  async requestBook(userId: number, bookId: number) {
    const faculty = await this.resolveFaculty(userId);
    const currentUser = this.facultyUser(userId);
    const rules = await this.librarySettings.getRules();

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + rules.defaultBorrowingDays);

    return this.borrowRecordsService.create(
      {
        book_id: bookId,
        borrower_type: BorrowerType.faculty,
        faculty_id: faculty.id,
        due_date: dueDate.toISOString().slice(0, 10),
      },
      currentUser,
    );
  }
}
