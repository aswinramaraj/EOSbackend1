import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  BorrowerType,
  CreateBorrowRecordDto,
} from './dto/create-borrow-record.dto';
import {
  BorrowRecordAction,
  UpdateBorrowRecordDto,
} from './dto/update-borrow-record.dto';
import {
  BorrowStatus,
  SearchBorrowRecordsDto,
} from './dto/search-borrow-records.dto';
import { GetMyBorrowRecordsDto } from './dto/get-my-borrow-records.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { LibrarySettingsService } from '../settings/settings.service';
import { NotificationsService } from '../../notifications/notifications/notifications.service';
import type { Prisma } from '../../../../generated/prisma/client';
import type { JwtPayload } from '../../../auth/interfaces/jwt-payload.interface';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(date: Date | string) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysBetween(later: Date | string, earlier: Date | string) {
  return Math.round(
    (startOfDay(later).getTime() - startOfDay(earlier).getTime()) / MS_PER_DAY,
  );
}

const RECORD_INCLUDE = {
  books: {
    select: {
      id: true,
      title: true,
      qr_code: true,
      price_per_copy: true,
    },
  },
  students: {
    select: {
      id: true,
      student_id_no: true,
      soa_applications: {
        select: {
          first_name: true,
          last_name: true,
        },
      },
    },
  },
  faculty: {
    select: {
      id: true,
      first_name: true,
      last_name: true,
    },
  },
};

type BorrowRecordWithRelations = Prisma.book_borrow_recordsGetPayload<{
  include: typeof RECORD_INCLUDE;
}>;

function formatRecord(record: BorrowRecordWithRelations, finePerDay: number) {
  const isOverdue =
    record.status === 'borrowed' &&
    startOfDay(record.due_date) < startOfDay(new Date());

  const returnedLate =
    record.status === 'returned' &&
    record.returned_date &&
    startOfDay(record.returned_date) > startOfDay(record.due_date);

  const daysOverdue = isOverdue ? daysBetween(new Date(), record.due_date) : 0;
  const daysLate =
    returnedLate && record.returned_date
      ? daysBetween(record.returned_date, record.due_date)
      : 0;

  return {
    id: record.id,
    book: {
      id: record.books.id,
      title: record.books.title,
      qr_code: record.books.qr_code,
    },
    borrower_type: record.borrower_type,
    student: record.students
      ? {
          id: record.students.id,
          student_id_no: record.students.student_id_no,
          // students has no name columns of its own (only faculty and
          // soa_applications do) — fall back to a labeled id rather than
          // null when there's no linked soa_application to pull a real
          // name from. This is a display placeholder, not a real name.
          name: record.students.soa_applications
            ? `${record.students.soa_applications.first_name} ${record.students.soa_applications.last_name ?? ''}`.trim()
            : `Student ${record.students.student_id_no}`,
        }
      : null,
    faculty: record.faculty
      ? {
          id: record.faculty.id,
          name: `${record.faculty.first_name} ${record.faculty.last_name}`,
        }
      : null,
    // staff_user_id: real column added by the Secretary module completion
    // migration, alongside the 'staff' borrower_type_enum value — a plain
    // users.id, no dedicated relation/name lookup exists for it here.
    staff_user_id: record.staff_user_id,
    borrowed_date: record.borrowed_date,
    due_date: record.due_date,
    returned_date: record.returned_date,
    status: record.status,
    renewal_count: record.renewal_count,
    last_renewed_at: record.last_renewed_at,
    is_overdue: isOverdue,
    days_overdue: daysOverdue,
    returned_late: !!returnedLate,
    days_late: daysLate,
    // Live/current amount owed — recomputed on every read from
    // days_overdue/days_late, NOT the persisted fine_paid_amount below.
    // days_overdue applies while still borrowed (accruing), days_late once
    // returned (final amount owed). Once fine_paid is true this stops
    // mattering for collection purposes but still reflects what the running
    // total would be, same as before this fine-collection feature existed.
    fine_amount: (isOverdue ? daysOverdue : daysLate) * finePerDay,
    fine_paid: record.fine_paid,
    fine_paid_amount:
      record.fine_paid_amount !== null ? Number(record.fine_paid_amount) : null,
    fine_paid_at: record.fine_paid_at,
    is_lost: record.status === 'lost',
    is_damaged: record.status === 'damaged',
    damage_lost_charge_amount:
      record.damage_lost_charge_amount !== null
        ? Number(record.damage_lost_charge_amount)
        : null,
    damage_lost_declared_at: record.damage_lost_declared_at,
    damage_lost_settled: record.damage_lost_settled,
    damage_lost_settled_at: record.damage_lost_settled_at,
  };
}

@Injectable()
export class BorrowRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly librarySettings: LibrarySettingsService,
    private readonly notifications: NotificationsService,
  ) {}

  async create(dto: CreateBorrowRecordDto, currentUser: JwtPayload) {
    if (!currentUser) {
      throw new ForbiddenException('No authenticated user found.');
    }

    const rules = await this.librarySettings.getRules();

    return this.prisma.$transaction(async (tx) => {
      // Check book
      const book = await tx.books.findUnique({
        where: {
          id: dto.book_id,
        },
      });

      if (!book) {
        throw new NotFoundException('Book not found.');
      }

      // Borrower validation — resolve exactly one of student_id/faculty_id
      // from the *declared* borrower_type, so a stray opposite-type id in
      // the body can never end up persisted alongside it (the schema's
      // student_id/faculty_id pair is meant to be mutually exclusive per
      // borrower_type; formatRecord() assumes only one is ever populated).
      let studentId: number | null = null;
      let facultyId: number | null = null;
      // staffUserId stays permanently null here — 'staff' borrower_type
      // records exist in the schema (added for a Secretary self-checkout
      // feature that was reverted: real books can only be checked out/
      // returned by library staff at the desk, so there's no genuine
      // self-service create path for a Secretary account). The column and
      // enum value are harmless to leave in place; this create() path
      // just never populates them.
      const staffUserId: number | null = null;

      if (currentUser.role === 'student') {
        // Self-service students may only ever borrow for themselves —
        // nothing in the DTO/role check otherwise stops a student account
        // from naming an arbitrary student_id or borrowing as faculty.
        if (dto.borrower_type !== BorrowerType.student) {
          throw new ForbiddenException(
            'Students may only create borrow records for themselves.',
          );
        }

        const ownStudent = await tx.students.findUnique({
          where: { user_id: currentUser.sub },
        });

        if (!ownStudent) {
          throw new NotFoundException(
            'No student profile is linked to this account.',
          );
        }

        if (dto.student_id && dto.student_id !== ownStudent.id) {
          throw new ForbiddenException(
            'Students may only create borrow records for themselves.',
          );
        }

        studentId = ownStudent.id;
      } else if (dto.borrower_type === BorrowerType.student) {
        if (!dto.student_id) {
          throw new BadRequestException('Student ID is required.');
        }

        const student = await tx.students.findUnique({
          where: { id: dto.student_id },
        });

        if (!student) {
          throw new NotFoundException('Student not found.');
        }

        studentId = dto.student_id;
      } else {
        if (!dto.faculty_id) {
          throw new BadRequestException('Faculty ID is required.');
        }

        const faculty = await tx.faculty.findUnique({
          where: { id: dto.faculty_id },
        });

        if (!faculty) {
          throw new NotFoundException('Faculty not found.');
        }

        facultyId = dto.faculty_id;
      }

      // Single read covers all three borrower-side rules below (overdue
      // block, same-book duplicate, concurrent cap) — one round trip
      // instead of three separate findFirst/count calls. Each borrow record
      // is tiny and a borrower's active count is bounded (students are
      // capped at MAX_ACTIVE_BORROWS_PER_STUDENT; faculty, while uncapped,
      // realistically never hold enough concurrently for this to matter),
      // so fetching the full active set and checking it in memory is both
      // fewer queries and simpler than composing three separate WHERE
      // clauses against the same rows.
      const activeBorrows = await tx.book_borrow_records.findMany({
        where: {
          status: 'borrowed',
          student_id: studentId ?? undefined,
          faculty_id: facultyId ?? undefined,
          staff_user_id: staffUserId ?? undefined,
        },
        select: { book_id: true, due_date: true },
      });

      // A borrower with any overdue book anywhere is blocked from taking out
      // anything new until it's resolved — otherwise overdue debt has no
      // real consequence and can grow unbounded across many different
      // books. Checked first since it's a blanket condition, not specific
      // to dto.book_id (unlike the two checks below).
      const hasOverdueBorrow = activeBorrows.some(
        (r) => startOfDay(r.due_date) < startOfDay(new Date()),
      );

      if (hasOverdueBorrow) {
        throw new ConflictException(
          'This borrower has an overdue book and cannot borrow additional books until it is returned.',
        );
      }

      // Same borrower can't have two active borrows of the same book —
      // checked before the copies count so the more specific "you already
      // have this book" conflict isn't masked by "no copies available"
      // when the last remaining copy happens to be this exact borrower's.
      const hasDuplicateBorrow = activeBorrows.some(
        (r) => r.book_id === dto.book_id,
      );

      if (hasDuplicateBorrow) {
        throw new ConflictException(
          'This borrower already has an active, unreturned copy of this book.',
        );
      }

      // Concurrent-borrow cap — students only (faculty are uncapped). A real
      // library limits how many books a member can hold at once.
      if (studentId && activeBorrows.length >= rules.booksPerStudent) {
        throw new ConflictException(
          `Students may not have more than ${rules.booksPerStudent} books borrowed at once.`,
        );
      }

      // Atomic check-and-decrement: the WHERE and the decrement happen in
      // one statement, so two truly concurrent borrows of the last copy
      // can't both pass a stale "available_copies > 0" read and both
      // succeed (which a separate read-then-update, as this used to be,
      // cannot guarantee under concurrent access). count === 0 means either
      // the book vanished (already excluded — checked above) or every copy
      // is currently out.
      const decremented = await tx.books.updateMany({
        where: {
          id: dto.book_id,
          available_copies: { gt: 0 },
        },
        data: {
          available_copies: { decrement: 1 },
        },
      });

      if (decremented.count === 0) {
        throw new ConflictException('No copies available for borrowing.');
      }

      const borrow = await tx.book_borrow_records.create({
        data: {
          book_id: dto.book_id,
          borrower_type: dto.borrower_type,
          student_id: studentId,
          faculty_id: facultyId,
          staff_user_id: staffUserId,
          due_date: new Date(dto.due_date),
        },
        include: RECORD_INCLUDE,
      });

      return formatRecord(borrow, rules.finePerDay);
    });
  }

  // Resolves the caller's own students/faculty row id from their user id.
  // Used to scope reads to "my own records" for student/faculty callers —
  // library/admin and every other role keep unrestricted read access,
  // matching the read contract on the other library submodules.
  private async resolveOwnStudentId(userId: number): Promise<number | null> {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
    });
    return student?.id ?? null;
  }

  private async resolveOwnFacultyId(userId: number): Promise<number | null> {
    const faculty = await this.prisma.faculty.findUnique({
      where: { user_id: userId },
    });
    return faculty?.id ?? null;
  }

  // GET /me/library/borrow-records — a student's own borrow history in a flatter
  // shape than formatRecord()'s (no nested student/faculty block, since the
  // caller *is* the student; no is_overdue/fine_amount, not part of this
  // endpoint's documented contract). A caller with no linked student profile
  // gets an empty list via the same -1 sentinel id used elsewhere, not an
  // error, matching findAll()'s ownership-scoping behavior.
  async findMyBorrowRecords(
    dto: GetMyBorrowRecordsDto,
    currentUser: JwtPayload,
  ) {
    const ownStudentId =
      (await this.resolveOwnStudentId(currentUser.sub)) ?? -1;

    const where: Prisma.book_borrow_recordsWhereInput = {
      student_id: ownStudentId,
    };

    // 'overdue' isn't a value ever persisted in the status column (see the
    // same mapping in findAll() above) — map it to the derived predicate.
    if (dto.status === BorrowStatus.overdue) {
      where.status = 'borrowed';
      where.due_date = { lt: new Date() };
    } else if (dto.status) {
      where.status = dto.status;
    }

    const records = await this.prisma.book_borrow_records.findMany({
      where,
      include: {
        books: {
          select: { title: true, author: true },
        },
      },
      orderBy: { borrowed_date: 'desc' },
    });

    return {
      success: true,
      message: 'Borrowed books fetched successfully',
      data: records.map((record) => ({
        id: record.id,
        book_id: record.book_id,
        title: record.books.title,
        author: record.books.author,
        borrowed_date: record.borrowed_date,
        due_date: record.due_date,
        returned_date: record.returned_date,
        status: record.status,
        renewal_count: record.renewal_count,
        last_renewed_at: record.last_renewed_at,
      })),
    };
  }

  /**
   * GET /me/library/dues-summary — a student's own outstanding library
   * dues, for the No-due clearance dashboard. Reuses the exact same
   * fine/charge formula as formatRecord() above (overdue/late fine =
   * days * finePerDay) and NoDueService.getStudents()'s
   * unsettled-damage/lost-charge logic, just scoped to one student instead
   * of every student, and summarized rather than itemized.
   */
  async getMyDuesSummary(currentUser: JwtPayload) {
    const ownStudentId =
      (await this.resolveOwnStudentId(currentUser.sub)) ?? -1;
    const { finePerDay } = await this.librarySettings.getRules();

    const records = await this.prisma.book_borrow_records.findMany({
      where: { student_id: ownStudentId },
      select: {
        status: true,
        due_date: true,
        returned_date: true,
        fine_paid: true,
        damage_lost_charge_amount: true,
        damage_lost_settled: true,
      },
    });

    let totalDue = 0;
    let overdueCount = 0;
    let unpaidFineCount = 0;

    for (const record of records) {
      const isOverdue =
        record.status === 'borrowed' &&
        startOfDay(record.due_date) < startOfDay(new Date());
      const returnedLate =
        record.status === 'returned' &&
        record.returned_date &&
        startOfDay(record.returned_date) > startOfDay(record.due_date);

      const daysOverdue = isOverdue
        ? daysBetween(new Date(), record.due_date)
        : 0;
      const daysLate =
        returnedLate && record.returned_date
          ? daysBetween(record.returned_date, record.due_date)
          : 0;
      const fineAmount = (isOverdue ? daysOverdue : daysLate) * finePerDay;

      if (isOverdue) overdueCount += 1;
      if (fineAmount > 0 && !record.fine_paid) {
        totalDue += fineAmount;
        unpaidFineCount += 1;
      }
      if (
        record.damage_lost_charge_amount !== null &&
        !record.damage_lost_settled
      ) {
        totalDue += Number(record.damage_lost_charge_amount);
        unpaidFineCount += 1;
      }
    }

    return {
      total_due: totalDue,
      overdue_count: overdueCount,
      unpaid_fine_count: unpaidFineCount,
    };
  }

  // GET /me/library/staff-borrow-records — a Secretary's (or any 'staff'
  // borrower's) own borrow history, mirroring findMyBorrowRecords() above
  // but keyed by staff_user_id instead of student_id.
  async findMyStaffBorrowRecords(
    dto: GetMyBorrowRecordsDto,
    currentUser: JwtPayload,
  ) {
    const where: Prisma.book_borrow_recordsWhereInput = {
      staff_user_id: currentUser.sub,
    };

    if (dto.status === BorrowStatus.overdue) {
      where.status = 'borrowed';
      where.due_date = { lt: new Date() };
    } else if (dto.status) {
      where.status = dto.status;
    }

    const records = await this.prisma.book_borrow_records.findMany({
      where,
      include: {
        books: {
          select: { title: true, author: true },
        },
      },
      orderBy: { borrowed_date: 'desc' },
    });

    return {
      success: true,
      message: 'Borrowed books fetched successfully',
      data: records.map((record) => ({
        id: record.id,
        book_id: record.book_id,
        title: record.books.title,
        author: record.books.author,
        borrowed_date: record.borrowed_date,
        due_date: record.due_date,
        returned_date: record.returned_date,
        status: record.status,
        renewal_count: record.renewal_count,
        last_renewed_at: record.last_renewed_at,
      })),
    };
  }

  async findAll(searchDto: SearchBorrowRecordsDto, currentUser: JwtPayload) {
    const {
      borrower_type,
      student_id,
      faculty_id,
      book_id,
      status,
      overdue = false,
      fine_paid,
      damage_lost_settled,
      page = 1,
      page_size = 20,
    } = searchDto;

    const where: Prisma.book_borrow_recordsWhereInput = {};

    if (borrower_type) {
      where.borrower_type = borrower_type;
    }

    if (student_id) {
      where.student_id = student_id;
    }

    if (faculty_id) {
      where.faculty_id = faculty_id;
    }

    if (book_id) {
      where.book_id = book_id;
    }

    if (status) {
      where.status = status;
    }

    // `status=overdue` is a query-side convenience, not a stored value —
    // the DB only ever persists 'borrowed'/'returned' (see remove()/update()
    // below), so an equality filter on the literal 'overdue' enum value
    // would always match zero rows. Map it to the same derived predicate
    // `overdue=true` already uses. `overdue=true` still takes precedence
    // when both are supplied, matching its existing override behavior.
    if (overdue || status === BorrowStatus.overdue) {
      where.status = 'borrowed';
      where.due_date = {
        lt: new Date(),
      };
    }

    if (fine_paid !== undefined) {
      where.fine_paid = fine_paid;
    }

    if (damage_lost_settled !== undefined) {
      where.damage_lost_settled = damage_lost_settled;
    }

    // A student/faculty caller can only ever see their own borrowing
    // history — any student_id/faculty_id filter they passed is overridden,
    // not rejected, since narrowing to "yourself" isn't an error, just the
    // only visibility you have. -1 is an unmatched sentinel id for a caller
    // with no linked profile, so the query returns an empty page instead
    // of throwing.
    if (currentUser?.role === 'student') {
      where.student_id =
        (await this.resolveOwnStudentId(currentUser.sub)) ?? -1;
    } else if (currentUser?.role === 'faculty') {
      where.faculty_id =
        (await this.resolveOwnFacultyId(currentUser.sub)) ?? -1;
    }

    const [rules, [records, total]] = await Promise.all([
      this.librarySettings.getRules(),
      this.prisma.$transaction([
        this.prisma.book_borrow_records.findMany({
          where,
          include: RECORD_INCLUDE,
          orderBy: {
            borrowed_date: 'desc',
          },
          skip: (page - 1) * page_size,
          take: page_size,
        }),

        this.prisma.book_borrow_records.count({
          where,
        }),
      ]),
    ]);

    return {
      page,
      page_size,
      total,
      data: records.map((r) => formatRecord(r, rules.finePerDay)),
    };
  }

  async findOne(id: number, currentUser: JwtPayload) {
    const record = await this.prisma.book_borrow_records.findUnique({
      where: {
        id,
      },
      include: RECORD_INCLUDE,
    });

    if (!record) {
      throw new NotFoundException('Borrow record not found.');
    }

    // Same ownership scoping as findAll(). A 404 (not 403) on someone
    // else's record is intentional — it doesn't confirm to an
    // unauthorized caller that the record exists at all.
    if (currentUser?.role === 'student') {
      const ownId = await this.resolveOwnStudentId(currentUser.sub);
      if (record.student_id !== ownId) {
        throw new NotFoundException('Borrow record not found.');
      }
    } else if (currentUser?.role === 'faculty') {
      const ownId = await this.resolveOwnFacultyId(currentUser.sub);
      if (record.faculty_id !== ownId) {
        throw new NotFoundException('Borrow record not found.');
      }
    }

    const rules = await this.librarySettings.getRules();
    return formatRecord(record, rules.finePerDay);
  }

  // No self-service renew for Secretary — reverted per the user's explicit
  // call that a real book can only be renewed/returned by library staff at
  // the desk (a physical handover/scan-in a self-service caller can't
  // perform). The Secretary Library screen is view-only:
  // findMyStaffBorrowRecords() above is its only real endpoint.

  async update(id: number, dto: UpdateBorrowRecordDto) {
    const record = await this.prisma.book_borrow_records.findUnique({
      where: {
        id,
      },
    });

    if (!record) {
      throw new NotFoundException('Borrow record not found.');
    }

    // 'returned'/'lost'/'damaged' are all terminal — none of the four
    // actions below apply once a record has left the active 'borrowed'
    // state (previously this only checked 'returned', back when it was the
    // only other status that existed).
    if (record.status !== 'borrowed') {
      throw new ConflictException(
        'Only an active (borrowed) record can be returned, renewed, or declared lost/damaged.',
      );
    }

    const rules = await this.librarySettings.getRules();

    if (dto.action === BorrowRecordAction.return) {
      const returnedDate = dto.return_date
        ? new Date(dto.return_date)
        : new Date();

      if (startOfDay(returnedDate) < startOfDay(record.borrowed_date)) {
        throw new BadRequestException(
          'Return date cannot be before the borrowed date.',
        );
      }

      return this.prisma.$transaction(async (tx) => {
        // Conditional on status: 'borrowed' so two concurrent "return" calls
        // on the same record can't both succeed and double-increment
        // available_copies — the outer status check above reads a stale
        // snapshot from before the transaction opened, so it alone can't
        // prevent that race; this updateMany's WHERE is the one that
        // actually enforces it atomically.
        const result = await tx.book_borrow_records.updateMany({
          where: {
            id,
            status: 'borrowed',
          },
          data: {
            status: 'returned',
            returned_date: returnedDate,
          },
        });

        if (result.count === 0) {
          throw new ConflictException('This book has already been returned.');
        }

        await tx.books.update({
          where: {
            id: record.book_id,
          },
          data: {
            available_copies: {
              increment: 1,
            },
          },
        });

        const updated = await tx.book_borrow_records.findUniqueOrThrow({
          where: { id },
          include: RECORD_INCLUDE,
        });

        return formatRecord(updated, rules.finePerDay);
      });
    }

    if (dto.action === BorrowRecordAction.renew) {
      const isCurrentlyOverdue =
        startOfDay(record.due_date) < startOfDay(new Date());

      if (isCurrentlyOverdue) {
        throw new ConflictException(
          'Cannot renew an overdue book. Please return it and issue a new borrow record instead.',
        );
      }

      if (record.renewal_count >= rules.maxRenewals) {
        throw new ConflictException(
          `Maximum renewal limit (${rules.maxRenewals}) reached for this borrow record.`,
        );
      }

      const newDueDate = dto.new_due_date
        ? new Date(dto.new_due_date)
        : new Date(
            record.due_date.getTime() +
              rules.renewalExtensionDays * 24 * 60 * 60 * 1000,
          );

      if (newDueDate <= record.due_date) {
        throw new BadRequestException(
          'New due date must be after the current due date.',
        );
      }

      const renewed = await this.prisma.book_borrow_records.update({
        where: {
          id,
        },
        data: {
          due_date: newDueDate,
          renewal_count: {
            increment: 1,
          },
          last_renewed_at: new Date(),
        },
        include: RECORD_INCLUDE,
      });

      return formatRecord(renewed, rules.finePerDay);
    }

    // Declare damaged or lost. Unlike return, the copy never comes back to
    // the shelf, so we permanently withdraw it (total_copies -1) instead of
    // returning it to circulation (available_copies +1) — available_copies
    // correctly stays down from when this record was created; nothing here
    // needs to touch it.
    return this.prisma.$transaction(async (tx) => {
      const book = await tx.books.findUniqueOrThrow({
        where: { id: record.book_id },
      });
      const bookCost = book.price_per_copy ? Number(book.price_per_copy) : 0;

      let chargeAmount: number;
      if (dto.action === BorrowRecordAction.damaged) {
        chargeAmount = bookCost * rules.damagedBookChargeRate;
      } else {
        // Lost: replacement cost + processing fee + whatever overdue fine
        // had already accrued on this copy at the moment it's declared lost.
        const isOverdue = startOfDay(record.due_date) < startOfDay(new Date());
        const accruedFine = isOverdue
          ? daysBetween(new Date(), record.due_date) * rules.finePerDay
          : 0;
        chargeAmount = bookCost + rules.lostBookProcessingFee + accruedFine;
      }

      const result = await tx.book_borrow_records.updateMany({
        where: { id, status: 'borrowed' },
        data: {
          status:
            dto.action === BorrowRecordAction.damaged ? 'damaged' : 'lost',
          damage_lost_charge_amount: chargeAmount,
          damage_lost_declared_at: new Date(),
        },
      });

      if (result.count === 0) {
        throw new ConflictException(
          'Only an active (borrowed) record can be declared lost/damaged.',
        );
      }

      await tx.books.update({
        where: { id: record.book_id },
        data: { total_copies: { decrement: 1 } },
      });

      const updated = await tx.book_borrow_records.findUniqueOrThrow({
        where: { id },
        include: RECORD_INCLUDE,
      });

      return formatRecord(updated, rules.finePerDay);
    });
  }

  /**
   * PATCH /library/borrow-records/:id/collect-fine — records that the
   * current overdue/late-return fine has been paid at the counter. No
   * waive counterpart exists: a fine is either uncollected or collected.
   */
  async collectFine(id: number, currentUser: JwtPayload) {
    const record = await this.prisma.book_borrow_records.findUnique({
      where: { id },
      include: RECORD_INCLUDE,
    });

    if (!record) {
      throw new NotFoundException('Borrow record not found.');
    }

    if (record.fine_paid) {
      throw new ConflictException('This fine has already been collected.');
    }

    const rules = await this.librarySettings.getRules();
    const formatted = formatRecord(record, rules.finePerDay);
    if (formatted.fine_amount <= 0) {
      throw new BadRequestException('There is no outstanding fine to collect.');
    }

    const updated = await this.prisma.book_borrow_records.update({
      where: { id },
      data: {
        fine_paid: true,
        fine_paid_amount: formatted.fine_amount,
        fine_paid_at: new Date(),
        fine_collected_by_user_id: currentUser.sub,
      },
      include: RECORD_INCLUDE,
    });

    return formatRecord(updated, rules.finePerDay);
  }

  /**
   * PATCH /library/borrow-records/:id/settle-charge — records that a
   * lost/damaged copy's charge has been paid at the counter.
   */
  async settleDamageLostCharge(id: number, currentUser: JwtPayload) {
    const record = await this.prisma.book_borrow_records.findUnique({
      where: { id },
      include: RECORD_INCLUDE,
    });

    if (!record) {
      throw new NotFoundException('Borrow record not found.');
    }

    if (record.status !== 'lost' && record.status !== 'damaged') {
      throw new ConflictException(
        'Only a record declared lost or damaged has a charge to settle.',
      );
    }

    if (record.damage_lost_settled) {
      throw new ConflictException('This charge has already been settled.');
    }

    const rules = await this.librarySettings.getRules();

    const updated = await this.prisma.book_borrow_records.update({
      where: { id },
      data: {
        damage_lost_settled: true,
        damage_lost_settled_at: new Date(),
        damage_lost_collected_by_user_id: currentUser.sub,
      },
      include: RECORD_INCLUDE,
    });

    return formatRecord(updated, rules.finePerDay);
  }

  async remove(id: number) {
    const record = await this.prisma.book_borrow_records.findUnique({
      where: {
        id,
      },
    });

    if (!record) {
      throw new NotFoundException('Borrow record not found.');
    }

    // A returned/lost/damaged record is permanent borrowing history, not a
    // live/active state — the books module already refuses to delete a book
    // that has *any* borrow_records row (P2003, "existing borrow history"),
    // so letting this endpoint freely delete one of these would erase
    // exactly the audit trail that guard exists to protect. An active
    // 'borrowed' record hasn't become history yet (no successful loan was
    // ever completed), so it can still be deleted to undo a mistaken issue,
    // same as before.
    if (record.status !== 'borrowed') {
      throw new ConflictException(
        'Cannot delete a returned, lost, or damaged borrow record — it is part of the permanent borrowing history.',
      );
    }

    await this.prisma.$transaction([
      this.prisma.book_borrow_records.delete({
        where: {
          id,
        },
      }),
      this.prisma.books.update({
        where: {
          id: record.book_id,
        },
        data: {
          available_copies: {
            increment: 1,
          },
        },
      }),
    ]);

    return {
      message: 'Borrow record deleted successfully.',
    };
  }

  /**
   * POST /library/borrow-records/send-overdue-reminders — creates an
   * in-app notification (bell icon inbox) plus a best-effort push
   * (NotificationsService.notify) for every borrower currently overdue.
   */
  async sendOverdueReminders() {
    const overdueRecords = await this.prisma.book_borrow_records.findMany({
      where: { status: 'borrowed', due_date: { lt: new Date() } },
      include: {
        books: { select: { title: true } },
        students: { select: { user_id: true } },
        faculty: { select: { user_id: true } },
      },
    });

    let sent = 0;
    for (const record of overdueRecords) {
      const userId = record.students?.user_id ?? record.faculty?.user_id;
      if (!userId) continue;

      await this.notifications.notify({
        user_id: userId,
        title: 'Overdue library book',
        message: `"${record.books.title}" was due on ${record.due_date.toISOString().slice(0, 10)}. Please return it to avoid further fines.`,
        type: 'library_overdue_reminder',
        related_entity_type: 'book_borrow_record',
        related_entity_id: record.id,
      });
      sent++;
    }

    return {
      message: `Sent ${sent} overdue reminder(s).`,
      sent,
      checked: overdueRecords.length,
    };
  }

  /**
   * POST /library/borrow-records/send-due-soon-reminders — the not-yet-
   * overdue sibling of sendOverdueReminders() above: still-borrowed books
   * due within the next DUE_SOON_WINDOW_DAYS days. Same
   * record/notify/resolve pattern, just a different due_date window and
   * notification type.
   */
  async sendDueSoonReminders() {
    const DUE_SOON_WINDOW_DAYS = 3;
    const now = new Date();
    const windowEnd = new Date(
      now.getTime() + DUE_SOON_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    );

    const dueSoonRecords = await this.prisma.book_borrow_records.findMany({
      where: { status: 'borrowed', due_date: { gte: now, lte: windowEnd } },
      include: {
        books: { select: { title: true } },
        students: { select: { user_id: true } },
        faculty: { select: { user_id: true } },
      },
    });

    let sent = 0;
    for (const record of dueSoonRecords) {
      const userId = record.students?.user_id ?? record.faculty?.user_id;
      if (!userId) continue;

      await this.notifications.notify({
        user_id: userId,
        title: 'Library book due soon',
        message: `"${record.books.title}" is due on ${record.due_date.toISOString().slice(0, 10)}.`,
        type: 'library_due_reminder',
        related_entity_type: 'book_borrow_record',
        related_entity_id: record.id,
      });
      sent++;
    }

    return {
      message: `Sent ${sent} due-soon reminder(s).`,
      sent,
      checked: dueSoonRecords.length,
    };
  }

  /**
   * PATCH /library/borrow-records/:id/create-replacement-indent — raises a
   * procurement purchase indent for a lost/damaged copy, and links it back
   * via replacement_indent_id so this doesn't get raised twice.
   */
  async createReplacementIndent(id: number, currentUser: JwtPayload) {
    const record = await this.prisma.book_borrow_records.findUnique({
      where: { id },
      include: { books: true },
    });

    if (!record) {
      throw new NotFoundException('Borrow record not found.');
    }

    if (record.status !== 'lost' && record.status !== 'damaged') {
      throw new ConflictException(
        'Only a record declared lost or damaged needs a replacement.',
      );
    }

    if (record.replacement_indent_id) {
      throw new ConflictException(
        'A replacement indent has already been raised for this record.',
      );
    }

    if (!record.books.department_id) {
      throw new BadRequestException(
        'This book has no department set — set one on the book before requesting a replacement.',
      );
    }

    const indent = await this.prisma.purchase_indents.create({
      data: {
        requested_by_user_id: currentUser.sub,
        department_id: record.books.department_id,
        item_name: `Replacement: ${record.books.title}`,
        quantity: 1,
        purpose: `Replacement for ${record.status} copy — borrow record #${record.id}, accession ${record.books.qr_code}`,
      },
    });

    await this.prisma.book_borrow_records.update({
      where: { id },
      data: { replacement_indent_id: indent.id },
    });

    return {
      message: 'Replacement purchase indent created.',
      purchase_indent_id: indent.id,
    };
  }
}
