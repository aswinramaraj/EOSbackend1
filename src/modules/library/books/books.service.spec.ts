jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { BooksService } from './books.service';
import { PrismaService } from 'src/prisma/prisma.service';

const BOOK_INCLUDE = {
  book_categories: { select: { id: true, name: true } },
  departments: { select: { id: true, name: true, code: true } },
  library_racks: { select: { id: true, rack_code: true, subject_range: true } },
};

describe('BooksService', () => {
  let service: BooksService;

  const mockPrismaService = {
    books: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    book_categories: {
      findUnique: jest.fn(),
    },
    departments: {
      findUnique: jest.fn(),
    },
    library_racks: {
      findUnique: jest.fn(),
    },
    book_borrow_records: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((ops: Promise<any>[]) => Promise.all(ops)),
    $queryRaw: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();
    mockPrismaService.$transaction.mockImplementation((ops: Promise<any>[]) =>
      Promise.all(ops),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BooksService,
        {
          provide: PrismaService,
          useValue: mockPrismaService,
        },
      ],
    }).compile();

    service = module.get<BooksService>(BooksService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    const createDto = {
      qr_code: 'QR-001',
      title: 'Clean Code',
      author: 'Robert Martin',
      category_id: 1,
      total_copies: 5,
    };

    it('should create a book successfully', async () => {
      mockPrismaService.books.findFirst.mockResolvedValue(null);
      mockPrismaService.books.findUnique.mockResolvedValue(null);
      mockPrismaService.book_categories.findUnique.mockResolvedValue({
        id: 1,
        name: 'Programming',
      });
      mockPrismaService.books.create.mockResolvedValue({
        id: 10,
        qr_code: 'QR-001',
        title: 'Clean Code',
        author: 'Robert Martin',
        isbn: null,
        publisher: null,
        edition: null,
        category_id: 1,
        total_copies: 5,
        available_copies: 5,
        price_per_copy: null,
        vendor_fund: null,
        book_categories: { id: 1, name: 'Programming' },
        departments: null,
        library_racks: null,
      });

      const result = await service.create(createDto);

      expect(mockPrismaService.books.findFirst).toHaveBeenCalledWith({
        where: {
          title: { equals: createDto.title, mode: 'insensitive' },
          author: { equals: createDto.author, mode: 'insensitive' },
          edition: null,
          deleted_at: null,
        },
        include: BOOK_INCLUDE,
      });
      expect(mockPrismaService.books.findUnique).toHaveBeenCalledWith({
        where: { qr_code: createDto.qr_code },
      });
      expect(mockPrismaService.book_categories.findUnique).toHaveBeenCalledWith(
        {
          where: { id: createDto.category_id },
        },
      );
      expect(mockPrismaService.departments.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.library_racks.findUnique).not.toHaveBeenCalled();
      expect(mockPrismaService.books.create).toHaveBeenCalledWith({
        data: {
          qr_code: createDto.qr_code,
          title: createDto.title,
          author: createDto.author,
          isbn: undefined,
          publisher: undefined,
          edition: undefined,
          category_id: createDto.category_id,
          department_id: undefined,
          rack_id: undefined,
          total_copies: createDto.total_copies,
          available_copies: createDto.total_copies,
          price_per_copy: undefined,
          vendor_fund: undefined,
        },
        include: BOOK_INCLUDE,
      });
      expect(result).toEqual({
        id: 10,
        qr_code: 'QR-001',
        title: 'Clean Code',
        author: 'Robert Martin',
        isbn: null,
        publisher: null,
        edition: null,
        category_id: 1,
        category_name: 'Programming',
        department: null,
        rack: null,
        total_copies: 5,
        available_copies: 5,
        price_per_copy: null,
        vendor_fund: null,
      });
    });

    it('should reject when available_copies exceeds total_copies', async () => {
      await expect(
        service.create({ ...createDto, available_copies: 99 }),
      ).rejects.toThrow(BadRequestException);
      expect(mockPrismaService.books.findFirst).not.toHaveBeenCalled();
    });

    it('should set available_copies independently when given ("copies on shelf")', async () => {
      mockPrismaService.books.findFirst.mockResolvedValue(null);
      mockPrismaService.books.findUnique.mockResolvedValue(null);
      mockPrismaService.book_categories.findUnique.mockResolvedValue({
        id: 1,
        name: 'Programming',
      });
      mockPrismaService.books.create.mockResolvedValue({
        id: 10,
        qr_code: 'QR-001',
        title: 'Clean Code',
        author: 'Robert Martin',
        isbn: null,
        publisher: null,
        edition: null,
        category_id: 1,
        total_copies: 5,
        available_copies: 3,
        price_per_copy: null,
        vendor_fund: null,
        book_categories: { id: 1, name: 'Programming' },
        departments: null,
        library_racks: null,
      });

      await service.create({ ...createDto, available_copies: 3 });

      expect(mockPrismaService.books.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            total_copies: 5,
            available_copies: 3,
          }),
        }),
      );
    });

    it('should validate department_id and rack_id when given', async () => {
      mockPrismaService.books.findFirst.mockResolvedValue(null);
      mockPrismaService.books.findUnique.mockResolvedValue(null);
      mockPrismaService.book_categories.findUnique.mockResolvedValue({
        id: 1,
        name: 'Programming',
      });
      mockPrismaService.departments.findUnique.mockResolvedValue(null);

      await expect(
        service.create({ ...createDto, department_id: 99 }),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.books.create).not.toHaveBeenCalled();
    });

    it('should increment copies instead of creating a duplicate when the same title + author + edition already exists', async () => {
      mockPrismaService.books.findFirst.mockResolvedValue({
        id: 7,
        qr_code: 'QR-EXISTING',
        title: 'Clean Code',
        author: 'Robert Martin',
        category_id: 1,
        total_copies: 3,
        available_copies: 2,
        book_categories: { id: 1, name: 'Programming' },
        departments: null,
        library_racks: null,
      });
      mockPrismaService.books.update.mockResolvedValue({
        id: 7,
        qr_code: 'QR-EXISTING',
        title: 'Clean Code',
        author: 'Robert Martin',
        isbn: null,
        publisher: null,
        edition: null,
        category_id: 1,
        total_copies: 8,
        available_copies: 7,
        price_per_copy: null,
        vendor_fund: null,
        book_categories: { id: 1, name: 'Programming' },
        departments: null,
        library_racks: null,
      });

      const result = await service.create(createDto);

      expect(mockPrismaService.books.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: {
          total_copies: { increment: createDto.total_copies },
          available_copies: { increment: createDto.total_copies },
        },
        include: BOOK_INCLUDE,
      });
      expect(mockPrismaService.books.findUnique).not.toHaveBeenCalled();
      expect(
        mockPrismaService.book_categories.findUnique,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.books.create).not.toHaveBeenCalled();
      expect(result).toEqual({
        id: 7,
        qr_code: 'QR-EXISTING',
        title: 'Clean Code',
        author: 'Robert Martin',
        isbn: null,
        publisher: null,
        edition: null,
        category_id: 1,
        category_name: 'Programming',
        department: null,
        rack: null,
        total_copies: 8,
        available_copies: 7,
        price_per_copy: null,
        vendor_fund: null,
      });
    });

    it('should throw ConflictException when QR code already exists', async () => {
      mockPrismaService.books.findFirst.mockResolvedValue(null);
      mockPrismaService.books.findUnique.mockResolvedValue({ id: 1 });

      await expect(service.create(createDto)).rejects.toThrow(
        ConflictException,
      );
      expect(
        mockPrismaService.book_categories.findUnique,
      ).not.toHaveBeenCalled();
      expect(mockPrismaService.books.create).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when category does not exist', async () => {
      mockPrismaService.books.findFirst.mockResolvedValue(null);
      mockPrismaService.books.findUnique.mockResolvedValue(null);
      mockPrismaService.book_categories.findUnique.mockResolvedValue(null);

      await expect(service.create(createDto)).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrismaService.books.create).not.toHaveBeenCalled();
    });
  });

  describe('findAll', () => {
    it('should return paginated books with default filters', async () => {
      const books = [
        {
          id: 1,
          qr_code: 'QR-1',
          title: 'A Book',
          author: 'Author',
          isbn: null,
          publisher: null,
          edition: null,
          total_copies: 2,
          available_copies: 1,
          price_per_copy: null,
          vendor_fund: null,
          book_categories: { id: 1, name: 'Fiction' },
          departments: null,
          library_racks: null,
        },
      ];
      mockPrismaService.books.findMany.mockResolvedValue(books);
      mockPrismaService.books.count.mockResolvedValue(1);

      const result = await service.findAll({});

      expect(mockPrismaService.$transaction).toHaveBeenCalled();
      expect(mockPrismaService.books.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { deleted_at: null },
          skip: 0,
          take: 20,
          orderBy: { title: 'asc' },
        }),
      );
      expect(result).toEqual({
        page: 1,
        page_size: 20,
        total: 1,
        data: [
          {
            id: 1,
            qr_code: 'QR-1',
            title: 'A Book',
            author: 'Author',
            isbn: null,
            publisher: null,
            edition: null,
            category_id: undefined,
            category_name: 'Fiction',
            department: null,
            rack: null,
            total_copies: 2,
            available_copies: 1,
            price_per_copy: null,
            vendor_fund: null,
          },
        ],
      });
    });

    it('should apply search query, category filter and pagination', async () => {
      mockPrismaService.books.findMany.mockResolvedValue([]);
      mockPrismaService.books.count.mockResolvedValue(0);

      await service.findAll({
        q: 'clean',
        category_id: 3,
        available_only: true,
        page: 2,
        page_size: 10,
      });

      expect(mockPrismaService.books.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            OR: [
              { title: { contains: 'clean', mode: 'insensitive' } },
              { author: { contains: 'clean', mode: 'insensitive' } },
            ],
            category_id: 3,
            available_copies: { gt: 0 },
            deleted_at: null,
          },
          skip: 10,
          take: 10,
        }),
      );
    });

    it('should apply the department and rack filters', async () => {
      mockPrismaService.books.findMany.mockResolvedValue([]);
      mockPrismaService.books.count.mockResolvedValue(0);

      await service.findAll({ department_id: 4, rack_id: 9 });

      expect(mockPrismaService.books.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { department_id: 4, rack_id: 9, deleted_at: null },
        }),
      );
    });

    it('should return empty data set when no books match', async () => {
      mockPrismaService.books.findMany.mockResolvedValue([]);
      mockPrismaService.books.count.mockResolvedValue(0);

      const result = await service.findAll({ q: 'nonexistent' });

      expect(result.data).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  describe('findOne', () => {
    it('should return a book when found', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        qr_code: 'QR-1',
        title: 'Title',
        author: 'Author',
        isbn: null,
        publisher: null,
        edition: null,
        category_id: 2,
        total_copies: 3,
        available_copies: 2,
        price_per_copy: null,
        vendor_fund: null,
        book_categories: { id: 2, name: 'Category' },
        departments: null,
        library_racks: null,
      });

      const result = await service.findOne(1);

      expect(mockPrismaService.books.findUnique).toHaveBeenCalledWith({
        where: { id: 1 },
        include: BOOK_INCLUDE,
      });
      expect(result.category_name).toBe('Category');
    });

    it('should throw NotFoundException when book does not exist', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue(null);

      await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('should throw NotFoundException when book does not exist', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue(null);

      await expect(service.update(1, { title: 'New title' })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });

    it('should reject when available_copies exceeds the (possibly updated) total_copies', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        total_copies: 5,
      });

      await expect(service.update(1, { available_copies: 10 })).rejects.toThrow(
        BadRequestException,
      );
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when new QR code belongs to another book', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        total_copies: 1,
      });
      mockPrismaService.books.findFirst.mockResolvedValue({ id: 2 });

      await expect(service.update(1, { qr_code: 'QR-DUP' })).rejects.toThrow(
        ConflictException,
      );
      expect(mockPrismaService.books.findFirst).toHaveBeenCalledWith({
        where: { qr_code: 'QR-DUP', NOT: { id: 1 } },
      });
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when new category does not exist', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        total_copies: 1,
      });
      mockPrismaService.book_categories.findUnique.mockResolvedValue(null);

      await expect(service.update(1, { category_id: 99 })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when new department does not exist', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        total_copies: 1,
      });
      mockPrismaService.departments.findUnique.mockResolvedValue(null);

      await expect(service.update(1, { department_id: 99 })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when new rack does not exist', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        total_copies: 1,
      });
      mockPrismaService.library_racks.findUnique.mockResolvedValue(null);

      await expect(service.update(1, { rack_id: 99 })).rejects.toThrow(
        NotFoundException,
      );
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });

    it('should update the book successfully', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        total_copies: 5,
      });
      mockPrismaService.books.update.mockResolvedValue({
        id: 1,
        qr_code: 'QR-1',
        title: 'Updated title',
        author: 'Author',
        isbn: null,
        publisher: null,
        edition: null,
        category_id: 1,
        total_copies: 5,
        available_copies: 5,
        price_per_copy: null,
        vendor_fund: null,
        book_categories: { id: 1, name: 'Programming' },
        departments: null,
        library_racks: null,
      });

      const result = await service.update(1, { title: 'Updated title' });

      expect(mockPrismaService.books.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { title: 'Updated title' },
        include: BOOK_INCLUDE,
      });
      expect(result.title).toBe('Updated title');
    });
  });

  describe('remove', () => {
    it('should throw NotFoundException when book does not exist', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue(null);

      await expect(service.remove(1)).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });

    it('should throw NotFoundException when the book is already deleted', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        deleted_at: new Date('2026-01-01'),
      });

      await expect(service.remove(1)).rejects.toThrow(NotFoundException);
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });

    it('should throw ConflictException when book is currently borrowed', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        deleted_at: null,
      });
      mockPrismaService.book_borrow_records.findFirst.mockResolvedValue({
        id: 5,
        status: 'borrowed',
      });

      await expect(service.remove(1)).rejects.toThrow(ConflictException);
      expect(mockPrismaService.books.update).not.toHaveBeenCalled();
    });

    it('should soft-delete the book when it has never been borrowed', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        deleted_at: null,
      });
      mockPrismaService.book_borrow_records.findFirst.mockResolvedValue(null);
      mockPrismaService.books.update.mockResolvedValue({ id: 1 });

      const result = await service.remove(1);

      expect(mockPrismaService.books.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { deleted_at: expect.any(Date), available_copies: 0 },
      });
      expect(result).toEqual({ message: 'Book deleted successfully.' });
    });

    // Regression test for the original bug: a book with only *returned*
    // borrow history (no active 'borrowed' record) must still be
    // deletable — book_borrow_records rows are never touched, so the
    // book_id -> books FK (onDelete: NoAction) never comes into play.
    it('should soft-delete the book when all its borrow records are returned', async () => {
      mockPrismaService.books.findUnique.mockResolvedValue({
        id: 1,
        deleted_at: null,
      });
      // No 'borrowed' record found even though returned history exists —
      // the service never queries returned records directly.
      mockPrismaService.book_borrow_records.findFirst.mockResolvedValue(null);
      mockPrismaService.books.update.mockResolvedValue({ id: 1 });

      const result = await service.remove(1);

      expect(mockPrismaService.book_borrow_records.findFirst).toHaveBeenCalledWith({
        where: { book_id: 1, status: 'borrowed' },
      });
      expect(mockPrismaService.books.delete).not.toHaveBeenCalled();
      expect(mockPrismaService.books.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: { deleted_at: expect.any(Date), available_copies: 0 },
      });
      expect(result).toEqual({ message: 'Book deleted successfully.' });
    });
  });

  describe('searchFuzzy', () => {
    it('should return matches ordered by similarity with scores exposed', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([
        {
          id: 1,
          qr_code: 'QR-001',
          title: 'Computer Science Engineering',
          author: null,
          isbn: null,
          publisher: null,
          edition: null,
          category_id: 1,
          category_name: 'Engineering',
          department_id: null,
          department_name: null,
          department_code: null,
          rack_id: null,
          rack_code: null,
          total_copies: 3,
          available_copies: 2,
          price_per_copy: null,
          vendor_fund: null,
          similarity: 0.62,
        },
      ]);

      const result = await service.searchFuzzy('computer scince enginering');

      expect(mockPrismaService.$queryRaw).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        {
          id: 1,
          qr_code: 'QR-001',
          title: 'Computer Science Engineering',
          author: null,
          isbn: null,
          publisher: null,
          edition: null,
          category_id: 1,
          category_name: 'Engineering',
          department: null,
          rack: null,
          total_copies: 3,
          available_copies: 2,
          price_per_copy: null,
          vendor_fund: null,
          similarity: 0.62,
        },
      ]);
    });

    it('should return an empty array when nothing matches', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      const result = await service.searchFuzzy('zzzqqqxxx');

      expect(result).toEqual([]);
    });

    it('should cap the limit at 20 even when a larger value is requested', async () => {
      mockPrismaService.$queryRaw.mockResolvedValue([]);

      await service.searchFuzzy('computer', 500);

      const templateArgs = mockPrismaService.$queryRaw.mock
        .calls[0] as unknown[];
      // Values interpolated into the tagged template are passed as
      // positional args after the strings array; the limit is the last one.
      expect(templateArgs[templateArgs.length - 1]).toBe(20);
    });
  });
});
