jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BorrowRecordsController } from './borrow-records.controller';
import { BorrowRecordsService } from './borrow-records.service';
import { BorrowerType } from './dto/create-borrow-record.dto';
import { BorrowRecordAction } from './dto/update-borrow-record.dto';

describe('BorrowRecordsController', () => {
  let controller: BorrowRecordsController;

  const mockBorrowRecordsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
    findMyBorrowRecords: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [BorrowRecordsController],
      providers: [
        {
          provide: BorrowRecordsService,
          useValue: mockBorrowRecordsService,
        },
      ],
    }).compile();

    controller = module.get<BorrowRecordsController>(BorrowRecordsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  const libraryUser = {
    sub: 1,
    email: 'library@eos.test',
    role: 'library',
    roleId: 8,
  };

  it('findAll should call service.findAll with the query dto, the current user, and return its result', async () => {
    const query = { student_id: 5, page: 1, page_size: 20 };
    const expected = { page: 1, page_size: 20, total: 0, data: [] };
    mockBorrowRecordsService.findAll.mockResolvedValue(expected);

    const result = await controller.findAll(query, libraryUser);

    expect(mockBorrowRecordsService.findAll).toHaveBeenCalledWith(
      query,
      libraryUser,
    );
    expect(result).toBe(expected);
  });

  it('findOne should call service.findOne with the parsed id, the current user, and return its result', async () => {
    const expected = { id: 3, status: 'borrowed' };
    mockBorrowRecordsService.findOne.mockResolvedValue(expected);

    const result = await controller.findOne(3, libraryUser);

    expect(mockBorrowRecordsService.findOne).toHaveBeenCalledWith(
      3,
      libraryUser,
    );
    expect(result).toBe(expected);
  });

  it('create should call service.create with the dto, the current user, and return its result', async () => {
    const dto = {
      book_id: 2,
      borrower_type: BorrowerType.student,
      student_id: 5,
      due_date: '2026-08-15',
    };
    const user = {
      sub: 1,
      email: 'library@eos.test',
      role: 'library',
      roleId: 8,
    };
    const expected = { id: 3, ...dto, status: 'borrowed' };
    mockBorrowRecordsService.create.mockResolvedValue(expected);

    const result = await controller.create(dto, user);

    expect(mockBorrowRecordsService.create).toHaveBeenCalledWith(dto, user);
    expect(result).toBe(expected);
  });

  it('update should call service.update with the parsed id and dto and return its result', async () => {
    const dto = { action: BorrowRecordAction.return };
    const expected = { id: 3, status: 'returned' };
    mockBorrowRecordsService.update.mockResolvedValue(expected);

    const result = await controller.update(3, dto);

    expect(mockBorrowRecordsService.update).toHaveBeenCalledWith(3, dto);
    expect(result).toBe(expected);
  });

  it('remove should call service.remove with the parsed id and return its result', async () => {
    const expected = { message: 'Borrow record deleted successfully.' };
    mockBorrowRecordsService.remove.mockResolvedValue(expected);

    const result = await controller.remove(3);

    expect(mockBorrowRecordsService.remove).toHaveBeenCalledWith(3);
    expect(result).toBe(expected);
  });

  const studentUser = {
    sub: 40,
    email: 'student@eos.test',
    role: 'student',
    roleId: 4,
  };

  it('findMyBorrowRecords should call service.findMyBorrowRecords with the query dto, the current user, and return its result', async () => {
    const query = { status: 'borrowed' as any };
    const expected = {
      success: true,
      message: 'Borrowed books fetched successfully',
      data: [],
    };
    mockBorrowRecordsService.findMyBorrowRecords.mockResolvedValue(expected);

    const result = await controller.findMyBorrowRecords(query, studentUser);

    expect(mockBorrowRecordsService.findMyBorrowRecords).toHaveBeenCalledWith(
      query,
      studentUser,
    );
    expect(result).toBe(expected);
  });
});
