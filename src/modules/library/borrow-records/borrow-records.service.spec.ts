jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BorrowRecordsService } from './borrow-records.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { LibrarySettingsService } from '../settings/settings.service';
import { NotificationsService } from '../../notifications/notifications/notifications.service';
import { BorrowerType } from './dto/create-borrow-record.dto';
import { BorrowRecordAction } from './dto/update-borrow-record.dto';

describe('BorrowRecordsService', () => {
  let service: BorrowRecordsService;

  const mockPrismaService = {
    books: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    students: {
      findUnique: jest.fn(),
    },
    faculty: {
      findUnique: jest.fn(),
    },
    book_borrow_records: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  // Values matching the schema defaults (books_per_student=3,
  // default_borrowing_days=14, max_renewals=2, renewal_extension_days=14,
  // fine_per_day=5, lost_book_processing_fee=100,
  // damaged_book_charge_rate=0.40), re-applied every test in beforeEach
  // below (jest.resetAllMocks() there wipes any mockResolvedValue set here).
  const mockLibrarySettingsService = {
    getRules: jest.fn(),
  };

  const mockNotificationsService = {
    create: jest.fn(),
  };

  // Runs both the callback form (used inside create/return) and the
  // array form (used by findAll/remove) against the same mock instance,
  // matching how Prisma's interactive vs. batch transactions behave.
  const runTransaction = (arg: any) =>
    typeof arg === 'function' ? arg(mockPrismaService) : Promise.all(arg);

  // Several fixtures below need a due_date that is guaranteed to still be
  // in the future whenever this suite runs (not overdue) — a hardcoded
  // absolute date (e.g. '2026-08-15') eventually becomes today's past and
  // silently flips these tests' meaning. Same idiom as the pre-existing
  // `tenDaysAgo` helper further down, generalized and made reusable.
  function daysFromNow(days: number): Date {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d;
  }

  // ISO 'YYYY-MM-DD' form, for DTO fields that take a date string.
  function isoDateFromNow(days: number): string {
    return daysFromNow(days).toISOString().slice(0, 10);
  }

  const includedBook = { id: 2, title: 'Clean Code', qr_code: 'BK-000123' };
  const includedStudent = {
    id: 5,
    student_id_no: 'AIDS2026043',
    soa_applications: { first_name: 'Mellow', last_name: 'Kumar' },
  };

  function makeRecord(overrides: Partial<Record<string, any>> = {}) {
    return {
      id: 3,
      book_id: 2,
      borrower_type: 'student',
      student_id: 5,
      faculty_id: null,
      borrowed_date: new Date('2026-07-28'),
      due_date: daysFromNow(14),
      returned_date: null,
      status: 'borrowed',
      renewal_count: 0,
      last_renewed_at: null,
      books: includedBook,
      students: includedStudent,
      faculty: null,
      ...overrides,
    };
  }

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrismaService.$transaction.mockImplementation(runTransaction);
    // resetAllMocks() wipes mockResolvedValue too, so this has to be
    // re-applied every test, same as the $transaction implementation above.
    mockLibrarySettingsService.getRules.mockResolvedValue({
      booksPerStudent: 3,
      defaultBorrowingDays: 14,
      maxRenewals: 2,
      renewalExtensionDays: 14,
      finePerDay: 5,
      lostBookProcessingFee: 100,
      damagedBookChargeRate: 0.4,
      gracePeriodDays: 1,
      blockIssueAboveFine: 200,
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BorrowRecordsService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
        {
          provide: LibrarySettingsService,
          useValue: mockLibrarySettingsService,
        },
        {
          provide: NotificationsService,
          useValue: mockNotificationsService,
        },
      ],
    }).compile();

    service = module.get<BorrowRecordsService>(BorrowRecordsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const studentDto = {
      book_id: 2,
      borrower_type: BorrowerType.student,
      student_id: 5,
      due_date: '2026-08-15',
    };

    const libraryUser = {
      sub: 1,
      email: 'library@eos.test',
      role: 'library',
      roleId: 8,
    };
    const studentUser = {
      sub: 40,
      email: 'student@eos.test',
      role: 'student',
      roleId: 4,
    };

    it('should create a borrow record for a student successfully (issued by library staff)', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 5 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.books.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.book_borrow_records.create.mockResolvedValue(
        makeRecord(),
      );

      const result = await service.create(studentDto, libraryUser);

      expect(mockPrismaService.book_borrow_records.create).toHaveBeenCalledWith(
        {
          data: {
            book_id: 2,
            borrower_type: 'student',
            student_id: 5,
            faculty_id: null,
            due_date: new Date('2026-08-15'),
          },
          include: expect.any(Object),
        },
      );
      expect(mockPrismaService.books.updateMany).toHaveBeenCalledWith({
        where: { id: 2, available_copies: { gt: 0 } },
        data: { available_copies: { decrement: 1 } },
      });
      expect(result).toMatchObject({
        id: 3,
        status: 'borrowed',
        student: {
          id: 5,
          student_id_no: 'AIDS2026043',
          name: 'Mellow Kumar',
        },
      });
    });

    it('should create a borrow record for faculty successfully', async () => {
      const facultyDto = {
        book_id: 2,
        borrower_type: BorrowerType.faculty,
        faculty_id: 9,
        due_date: '2026-08-15',
      };

      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 1,
      });
      mockPrismaService.faculty.findUnique.mockResolvedValue({ id: 9 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.books.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.book_borrow_records.create.mockResolvedValue(
        makeRecord({
          borrower_type: 'faculty',
          student_id: null,
          faculty_id: 9,
          students: null,
          faculty: { id: 9, first_name: 'John', last_name: 'Doe' },
        }),
      );

      const result = await service.create(facultyDto, libraryUser);

      expect(mockPrismaService.students.findUnique).not.toHaveBeenCalled();
      expect(result.faculty).toEqual({ id: 9, name: 'John Doe' });
      expect(result.student).toBeNull();
    });

    it('should throw NotFoundException when book does not exist', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue(null);

      await expect(service.create(studentDto, libraryUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(
        mockPrismaService.book_borrow_records.create,
      ).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when no copies are available', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 0,
      });
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 5 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.books.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.create(studentDto, libraryUser)).rejects.toThrow(
        ConflictException,
      );
      expect(
        mockPrismaService.book_borrow_records.create,
      ).not.toHaveBeenCalled();
    });

    it('should atomically guard against a concurrent borrow taking the last copy first (race-safe decrement)', async () => {
      // Simulates two near-simultaneous requests for the last copy: the
      // conditional updateMany (available_copies > 0) is what actually
      // enforces this, not a separate read — a stale read-then-write
      // couldn't guarantee this under real concurrency.
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 1,
      });
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 5 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.books.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.create(studentDto, libraryUser)).rejects.toThrow(
        'No copies available for borrowing.',
      );
      expect(mockPrismaService.books.updateMany).toHaveBeenCalledWith({
        where: { id: 2, available_copies: { gt: 0 } },
        data: { available_copies: { decrement: 1 } },
      });
      expect(
        mockPrismaService.book_borrow_records.create,
      ).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException when borrower_type is student but student_id is missing (library staff)', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });

      await expect(
        service.create(
          {
            book_id: 2,
            borrower_type: BorrowerType.student,
            due_date: '2026-08-15',
          } as any,
          libraryUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException when borrower_type is faculty but faculty_id is missing', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });

      await expect(
        service.create(
          {
            book_id: 2,
            borrower_type: BorrowerType.faculty,
            due_date: '2026-08-15',
          } as any,
          libraryUser,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException when student does not exist', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });
      mockPrismaService.students.findUnique.mockResolvedValue(null);

      await expect(service.create(studentDto, libraryUser)).rejects.toThrow(
        NotFoundException,
      );
      expect(
        mockPrismaService.book_borrow_records.create,
      ).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when faculty does not exist', async () => {
      const facultyDto = {
        book_id: 2,
        borrower_type: BorrowerType.faculty,
        faculty_id: 9,
        due_date: '2026-08-15',
      };
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });
      mockPrismaService.faculty.findUnique.mockResolvedValue(null);

      await expect(service.create(facultyDto, libraryUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should throw ConflictException when the borrower already has an active borrow of this book', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 5 });
      // Same borrower's one active record is for the exact book being
      // requested (book_id: 2) and not overdue — should trip the
      // duplicate-borrow check, not the overdue check.
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([
        { book_id: 2, due_date: daysFromNow(14) },
      ]);

      await expect(service.create(studentDto, libraryUser)).rejects.toThrow(
        ConflictException,
      );
      expect(
        mockPrismaService.book_borrow_records.create,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.books.updateMany).not.toHaveBeenCalled();
    });

    it('should prioritize the duplicate-active-borrow conflict over the no-copies conflict when both are true', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 0,
      });
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 5 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([
        { book_id: 2, due_date: daysFromNow(14) },
      ]);

      await expect(service.create(studentDto, libraryUser)).rejects.toThrow(
        'This borrower already has an active, unreturned copy of this book.',
      );
    });

    it('should throw ConflictException when the borrower has an overdue book, before even checking the same-book duplicate', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 5 });
      // Active record is for a *different* book (99) and is overdue —
      // should trip the overdue check even though book_id doesn't match
      // the one being requested.
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([
        { book_id: 99, due_date: new Date('2020-01-01') },
      ]);

      await expect(service.create(studentDto, libraryUser)).rejects.toThrow(
        'This borrower has an overdue book and cannot borrow additional books until it is returned.',
      );
      expect(
        mockPrismaService.book_borrow_records.create,
      ).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when a student already has 3 active borrows', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 5 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([
        { book_id: 10, due_date: daysFromNow(14) },
        { book_id: 11, due_date: daysFromNow(14) },
        { book_id: 12, due_date: daysFromNow(14) },
      ]);

      await expect(service.create(studentDto, libraryUser)).rejects.toThrow(
        'Students may not have more than 3 books borrowed at once.',
      );
      expect(
        mockPrismaService.book_borrow_records.create,
      ).not.toHaveBeenCalled();
    });

    it('should allow a 3rd active borrow when the student currently has 2', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 5 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([
        { book_id: 10, due_date: daysFromNow(14) },
        { book_id: 11, due_date: daysFromNow(14) },
      ]);
      mockPrismaService.books.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.book_borrow_records.create.mockResolvedValue(
        makeRecord(),
      );

      await expect(
        service.create(studentDto, libraryUser),
      ).resolves.toMatchObject({ id: 3 });
    });

    it('should not apply the concurrent-borrow cap to faculty, even when they already hold more than the student cap', async () => {
      const facultyDto = {
        book_id: 2,
        borrower_type: BorrowerType.faculty,
        faculty_id: 9,
        due_date: '2026-08-15',
      };

      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });
      mockPrismaService.faculty.findUnique.mockResolvedValue({ id: 9 });
      // 5 other active borrows — well past the student cap of 3 — should
      // still succeed, since the cap only applies when studentId is set.
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([
        { book_id: 10, due_date: daysFromNow(14) },
        { book_id: 11, due_date: daysFromNow(14) },
        { book_id: 12, due_date: daysFromNow(14) },
        { book_id: 13, due_date: daysFromNow(14) },
        { book_id: 14, due_date: daysFromNow(14) },
      ]);
      mockPrismaService.books.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.book_borrow_records.create.mockResolvedValue(
        makeRecord({
          borrower_type: 'faculty',
          student_id: null,
          faculty_id: 9,
          students: null,
          faculty: { id: 9, first_name: 'John', last_name: 'Doe' },
        }),
      );

      await expect(
        service.create(facultyDto, libraryUser),
      ).resolves.toMatchObject({ id: 3 });
    });

    it('should ignore a mismatched faculty_id when borrower_type is student and never persist it', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 2,
        available_copies: 3,
      });
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 5 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.books.updateMany.mockResolvedValue({ count: 1 });
      mockPrismaService.book_borrow_records.create.mockResolvedValue(
        makeRecord(),
      );

      await service.create({ ...studentDto, faculty_id: 999 }, libraryUser);

      expect(mockPrismaService.book_borrow_records.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ student_id: 5, faculty_id: null }),
        }),
      );
    });

    describe('self-service student authorization', () => {
      it("resolves student_id from the caller's own profile and ignores an absent student_id", async () => {
        mockPrismaService.books.findUnique.mockResolvedValue({
          id: 2,
          available_copies: 3,
        });
        mockPrismaService.students.findUnique.mockResolvedValue({ id: 7 });
        mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
        mockPrismaService.books.updateMany.mockResolvedValue({ count: 1 });
        mockPrismaService.book_borrow_records.create.mockResolvedValue(
          makeRecord({ student_id: 7 }),
        );

        await service.create(
          {
            book_id: 2,
            borrower_type: BorrowerType.student,
            due_date: '2026-08-15',
          },
          studentUser,
        );

        expect(mockPrismaService.students.findUnique).toHaveBeenCalledWith({
          where: { user_id: studentUser.sub },
        });
        expect(
          mockPrismaService.book_borrow_records.create,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ student_id: 7, faculty_id: null }),
          }),
        );
      });

      it('throws ForbiddenException when a student tries to borrow as faculty', async () => {
        mockPrismaService.books.findUnique.mockResolvedValue({
          id: 2,
          available_copies: 3,
        });

        await expect(
          service.create(
            {
              book_id: 2,
              borrower_type: BorrowerType.faculty,
              faculty_id: 9,
              due_date: '2026-08-15',
            } as any,
            studentUser,
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(
          mockPrismaService.book_borrow_records.create,
        ).not.toHaveBeenCalled();
      });

      it('throws ForbiddenException when a student names a different student_id', async () => {
        mockPrismaService.books.findUnique.mockResolvedValue({
          id: 2,
          available_copies: 3,
        });
        mockPrismaService.students.findUnique.mockResolvedValue({ id: 7 });

        await expect(
          service.create(
            {
              book_id: 2,
              borrower_type: BorrowerType.student,
              student_id: 999,
              due_date: '2026-08-15',
            } as any,
            studentUser,
          ),
        ).rejects.toThrow(ForbiddenException);
        expect(
          mockPrismaService.book_borrow_records.create,
        ).not.toHaveBeenCalled();
      });

      it('throws NotFoundException when the student account has no linked student profile', async () => {
        mockPrismaService.books.findUnique.mockResolvedValue({
          id: 2,
          available_copies: 3,
        });
        mockPrismaService.students.findUnique.mockResolvedValue(null);

        await expect(
          service.create(
            {
              book_id: 2,
              borrower_type: BorrowerType.student,
              due_date: '2026-08-15',
            } as any,
            studentUser,
          ),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('findAll', () => {
    const libraryUser = {
      sub: 1,
      email: 'library@eos.test',
      role: 'library',
      roleId: 8,
    };
    const studentUser = {
      sub: 40,
      email: 'student@eos.test',
      role: 'student',
      roleId: 4,
    };
    const facultyUser = {
      sub: 41,
      email: 'faculty@eos.test',
      role: 'faculty',
      roleId: 3,
    };

    it('should return paginated results with no filters (library — unrestricted)', async () => {
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([
        makeRecord(),
      ]);
      mockPrismaService.book_borrow_records.count.mockResolvedValue(1);

      const result = await service.findAll({}, libraryUser);

      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {},
          skip: 0,
          take: 20,
        }),
      );
      expect(result.total).toBe(1);
      expect(result.data[0]).toMatchObject({ id: 3, status: 'borrowed' });
    });

    it('should apply borrower/status/book filters and pagination', async () => {
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.book_borrow_records.count.mockResolvedValue(0);

      await service.findAll(
        {
          borrower_type: BorrowerType.student,
          student_id: 5,
          book_id: 2,
          status: 'borrowed' as any,
          page: 2,
          page_size: 10,
        },
        libraryUser,
      );

      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            borrower_type: 'student',
            student_id: 5,
            book_id: 2,
            status: 'borrowed',
          },
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should override status with the overdue filter when overdue=true', async () => {
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.book_borrow_records.count.mockResolvedValue(0);

      await service.findAll(
        { status: 'returned' as any, overdue: true },
        libraryUser,
      );

      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'borrowed',
            due_date: { lt: expect.any(Date) },
          },
        }),
      );
    });

    it('should map status=overdue to the derived borrowed+past-due-date filter, since the DB never stores that literal status', async () => {
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.book_borrow_records.count.mockResolvedValue(0);

      await service.findAll({ status: 'overdue' as any }, libraryUser);

      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'borrowed',
            due_date: { lt: expect.any(Date) },
          },
        }),
      );
    });

    it("should scope results to the caller's own student_id and ignore a different requested student_id", async () => {
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.book_borrow_records.count.mockResolvedValue(0);
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 7 });

      await service.findAll({ student_id: 999 }, studentUser);

      expect(mockPrismaService.students.findUnique).toHaveBeenCalledWith({
        where: { user_id: studentUser.sub },
      });
      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { student_id: 7 } }),
      );
    });

    it("should scope results to the caller's own faculty_id", async () => {
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.book_borrow_records.count.mockResolvedValue(0);
      mockPrismaService.faculty.findUnique.mockResolvedValue({ id: 9 });

      await service.findAll({}, facultyUser);

      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { faculty_id: 9 } }),
      );
    });

    it('should scope to an unmatched sentinel id when a student caller has no linked profile', async () => {
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);
      mockPrismaService.book_borrow_records.count.mockResolvedValue(0);
      mockPrismaService.students.findUnique.mockResolvedValue(null);

      await service.findAll({}, studentUser);

      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { student_id: -1 } }),
      );
    });
  });

  describe('findOne', () => {
    const libraryUser = {
      sub: 1,
      email: 'library@eos.test',
      role: 'library',
      roleId: 8,
    };
    const studentUser = {
      sub: 40,
      email: 'student@eos.test',
      role: 'student',
      roleId: 4,
    };

    it('should return the formatted record when found (library — unrestricted)', async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
        makeRecord(),
      );

      const result = await service.findOne(3, libraryUser);

      expect(
        mockPrismaService.book_borrow_records.findUnique,
      ).toHaveBeenCalledWith({
        where: { id: 3 },
        include: expect.any(Object),
      });
      expect(result.id).toBe(3);
    });

    it('should throw NotFoundException when not found', async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999, libraryUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should return a student's own record", async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
        makeRecord({ student_id: 7 }),
      );
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 7 });

      const result = await service.findOne(3, studentUser);

      expect(result.id).toBe(3);
    });

    it("should throw NotFoundException (not Forbidden) when a student requests someone else's record", async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
        makeRecord({ student_id: 5 }),
      );
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 7 });

      await expect(service.findOne(3, studentUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('should compute a fine_amount of 0 for a record that is neither overdue nor returned late', async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
        makeRecord({ due_date: daysFromNow(14) }),
      );

      const result = await service.findOne(3, libraryUser);

      expect(result.fine_amount).toBe(0);
    });

    it('should compute a positive fine_amount for a currently overdue record', async () => {
      const tenDaysAgo = new Date();
      tenDaysAgo.setDate(tenDaysAgo.getDate() - 10);

      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
        makeRecord({ due_date: tenDaysAgo }),
      );

      const result = await service.findOne(3, libraryUser);

      expect(result.days_overdue).toBe(10);
      expect(result.fine_amount).toBe(50);
    });

    it('should fall back to a labeled placeholder name when the student has no linked soa_application', async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
        makeRecord({
          students: {
            id: 5,
            student_id_no: 'AIDS2026043',
            soa_applications: null,
          },
        }),
      );

      const result = await service.findOne(3, libraryUser);

      expect(result.student?.name).toBe('Student AIDS2026043');
    });
  });

  describe('update', () => {
    it('should throw NotFoundException when the record does not exist', async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(null);

      await expect(
        service.update(3, { action: BorrowRecordAction.return }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException when the record is already returned', async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
        makeRecord({
          status: 'returned',
          returned_date: new Date('2026-08-01'),
        }),
      );

      await expect(
        service.update(3, { action: BorrowRecordAction.return }),
      ).rejects.toThrow(ConflictException);
      expect(
        mockPrismaService.book_borrow_records.update,
      ).not.toHaveBeenCalled();
    });

    describe('action: return', () => {
      it('should mark the record returned, restore available_copies, and use the given return_date', async () => {
        mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
          makeRecord({ due_date: new Date('2026-07-18') }),
        );
        mockPrismaService.book_borrow_records.updateMany.mockResolvedValue({
          count: 1,
        });
        mockPrismaService.books.update.mockResolvedValue({});
        mockPrismaService.book_borrow_records.findUniqueOrThrow.mockResolvedValue(
          makeRecord({
            status: 'returned',
            due_date: new Date('2026-07-18'),
            returned_date: new Date('2026-07-28'),
          }),
        );

        const result = await service.update(3, {
          action: BorrowRecordAction.return,
          return_date: '2026-07-28',
        });

        expect(
          mockPrismaService.book_borrow_records.updateMany,
        ).toHaveBeenCalledWith({
          where: { id: 3, status: 'borrowed' },
          data: {
            status: 'returned',
            returned_date: new Date('2026-07-28'),
          },
        });
        expect(mockPrismaService.books.update).toHaveBeenCalledWith({
          where: { id: 2 },
          data: { available_copies: { increment: 1 } },
        });
        expect(result.status).toBe('returned');
        expect(result.returned_late).toBe(true);
        expect(result.days_late).toBe(10);
      });

      it('should default return_date to now when not provided', async () => {
        mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
          makeRecord(),
        );
        mockPrismaService.book_borrow_records.updateMany.mockResolvedValue({
          count: 1,
        });
        mockPrismaService.books.update.mockResolvedValue({});
        mockPrismaService.book_borrow_records.findUniqueOrThrow.mockResolvedValue(
          makeRecord({ status: 'returned', returned_date: new Date() }),
        );

        await service.update(3, { action: BorrowRecordAction.return });

        expect(
          mockPrismaService.book_borrow_records.updateMany,
        ).toHaveBeenCalledWith({
          where: { id: 3, status: 'borrowed' },
          data: {
            status: 'returned',
            returned_date: expect.any(Date),
          },
        });
      });

      it('should throw BadRequestException when return_date is before the borrowed_date', async () => {
        mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
          makeRecord({ borrowed_date: new Date('2026-07-28') }),
        );

        await expect(
          service.update(3, {
            action: BorrowRecordAction.return,
            return_date: '2026-07-01',
          }),
        ).rejects.toThrow(BadRequestException);
        expect(
          mockPrismaService.book_borrow_records.updateMany,
        ).not.toHaveBeenCalled();
      });

      it('should throw ConflictException if the record was returned by a concurrent request between the initial check and the update', async () => {
        // Simulates two near-simultaneous "return" calls on the same
        // record: the outer status check (done before the transaction
        // opens) reads a stale 'borrowed' snapshot, but the conditional
        // updateMany inside the transaction is what actually catches it.
        mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
          makeRecord(),
        );
        mockPrismaService.book_borrow_records.updateMany.mockResolvedValue({
          count: 0,
        });

        await expect(
          service.update(3, { action: BorrowRecordAction.return }),
        ).rejects.toThrow('This book has already been returned.');
        expect(mockPrismaService.books.update).not.toHaveBeenCalled();
      });
    });

    describe('action: renew', () => {
      it('should extend due_date by 14 days by default and bump renewal_count', async () => {
        const dueDate = daysFromNow(30);
        const renewedDueDate = new Date(
          dueDate.getTime() + 14 * 24 * 60 * 60 * 1000,
        );

        mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
          makeRecord({ due_date: dueDate }),
        );
        mockPrismaService.book_borrow_records.update.mockResolvedValue(
          makeRecord({
            due_date: renewedDueDate,
            renewal_count: 1,
            last_renewed_at: new Date(),
          }),
        );

        const result = await service.update(3, {
          action: BorrowRecordAction.renew,
        });

        expect(
          mockPrismaService.book_borrow_records.update,
        ).toHaveBeenCalledWith({
          where: { id: 3 },
          data: {
            due_date: renewedDueDate,
            renewal_count: { increment: 1 },
            last_renewed_at: expect.any(Date),
          },
          include: expect.any(Object),
        });
        expect(result.renewal_count).toBe(1);
      });

      it('should use the provided new_due_date when given', async () => {
        const dueDate = daysFromNow(30);
        const newDueDate = isoDateFromNow(60);

        mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
          makeRecord({ due_date: dueDate }),
        );
        mockPrismaService.book_borrow_records.update.mockResolvedValue(
          makeRecord({ due_date: new Date(newDueDate), renewal_count: 1 }),
        );

        await service.update(3, {
          action: BorrowRecordAction.renew,
          new_due_date: newDueDate,
        });

        expect(
          mockPrismaService.book_borrow_records.update,
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              due_date: new Date(newDueDate),
            }),
          }),
        );
      });

      it('should throw BadRequestException when new_due_date is not after the current due_date', async () => {
        mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
          makeRecord({ due_date: daysFromNow(30) }),
        );

        await expect(
          service.update(3, {
            action: BorrowRecordAction.renew,
            new_due_date: isoDateFromNow(10),
          }),
        ).rejects.toThrow(BadRequestException);
        expect(
          mockPrismaService.book_borrow_records.update,
        ).not.toHaveBeenCalled();
      });

      it('should throw ConflictException when the record is already overdue', async () => {
        mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
          makeRecord({ due_date: new Date('2020-01-01') }),
        );

        await expect(
          service.update(3, { action: BorrowRecordAction.renew }),
        ).rejects.toThrow(ConflictException);
        expect(
          mockPrismaService.book_borrow_records.update,
        ).not.toHaveBeenCalled();
      });

      it('should throw ConflictException when the renewal limit has already been reached', async () => {
        mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
          makeRecord({
            due_date: daysFromNow(30),
            renewal_count: 2,
          }),
        );

        await expect(
          service.update(3, { action: BorrowRecordAction.renew }),
        ).rejects.toThrow(ConflictException);
        expect(
          mockPrismaService.book_borrow_records.update,
        ).not.toHaveBeenCalled();
      });
    });
  });

  describe('findMyBorrowRecords', () => {
    const studentUser = {
      sub: 40,
      email: 'student@eos.test',
      role: 'student',
      roleId: 4,
    };

    const makeMyRecord = (overrides: Partial<Record<string, any>> = {}) => ({
      id: 3,
      book_id: 2,
      borrowed_date: new Date('2026-07-01'),
      due_date: new Date('2026-07-15'),
      returned_date: null,
      status: 'borrowed',
      renewal_count: 1,
      last_renewed_at: new Date('2026-07-14T10:00:00Z'),
      books: { title: 'Introduction to Algorithms', author: 'Cormen et al.' },
      ...overrides,
    });

    it("returns the caller's own borrow records in the documented flat shape", async () => {
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 7 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([
        makeMyRecord(),
      ]);

      const result = await service.findMyBorrowRecords({}, studentUser);

      expect(mockPrismaService.students.findUnique).toHaveBeenCalledWith({
        where: { user_id: studentUser.sub },
      });
      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { student_id: 7 },
          orderBy: { borrowed_date: 'desc' },
        }),
      );
      expect(result).toEqual({
        success: true,
        message: 'Borrowed books fetched successfully',
        data: [
          {
            id: 3,
            book_id: 2,
            title: 'Introduction to Algorithms',
            author: 'Cormen et al.',
            borrowed_date: new Date('2026-07-01'),
            due_date: new Date('2026-07-15'),
            returned_date: null,
            status: 'borrowed',
            renewal_count: 1,
            last_renewed_at: new Date('2026-07-14T10:00:00Z'),
          },
        ],
      });
    });

    it('filters by a plain status value (borrowed/returned)', async () => {
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 7 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);

      await service.findMyBorrowRecords(
        { status: 'returned' as any },
        studentUser,
      );

      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { student_id: 7, status: 'returned' },
        }),
      );
    });

    it('maps status=overdue to the derived borrowed+past-due-date filter, since the DB never stores that literal status', async () => {
      mockPrismaService.students.findUnique.mockResolvedValue({ id: 7 });
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);

      await service.findMyBorrowRecords(
        { status: 'overdue' as any },
        studentUser,
      );

      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            student_id: 7,
            status: 'borrowed',
            due_date: { lt: expect.any(Date) },
          },
        }),
      );
    });

    it('scopes to an unmatched sentinel id (empty result, not an error) when the caller has no linked student profile', async () => {
      mockPrismaService.students.findUnique.mockResolvedValue(null);
      mockPrismaService.book_borrow_records.findMany.mockResolvedValue([]);

      const result = await service.findMyBorrowRecords({}, studentUser);

      expect(
        mockPrismaService.book_borrow_records.findMany,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ where: { student_id: -1 } }),
      );
      expect(result.data).toEqual([]);
    });
  });

  describe('remove', () => {
    it('should throw NotFoundException when the record does not exist', async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(null);

      await expect(service.remove(3)).rejects.toThrow(NotFoundException);
    });

    it('should delete and restore available_copies when the record is still borrowed', async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
        makeRecord({ status: 'borrowed' }),
      );
      mockPrismaService.book_borrow_records.delete.mockResolvedValue({});
      mockPrismaService.books.update.mockResolvedValue({});

      const result = await service.remove(3);

      expect(mockPrismaService.book_borrow_records.delete).toHaveBeenCalledWith(
        { where: { id: 3 } },
      );
      expect(mockPrismaService.books.update).toHaveBeenCalledWith({
        where: { id: 2 },
        data: { available_copies: { increment: 1 } },
      });
      expect(result).toEqual({
        message: 'Borrow record deleted successfully.',
      });
    });

    it('should refuse to delete a returned record, since it is permanent borrowing history', async () => {
      mockPrismaService.book_borrow_records.findUnique.mockResolvedValue(
        makeRecord({
          status: 'returned',
          returned_date: new Date('2026-08-01'),
        }),
      );

      await expect(service.remove(3)).rejects.toThrow(ConflictException);
      expect(
        mockPrismaService.book_borrow_records.delete,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });
  });
});
