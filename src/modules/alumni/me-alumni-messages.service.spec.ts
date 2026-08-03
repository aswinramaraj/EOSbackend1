import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MeAlumniMessagesService } from './me-alumni-messages.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { PaginationDto } from 'src/common/dto/pagination.dto';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('MeAlumniMessagesService', () => {
  let service: MeAlumniMessagesService;
  let mockPrisma: any;

  const memberBatchA = { id: 1, alumni_batch_id: 100 }; // student in batch A
  const memberBatchB = { id: 2, alumni_batch_id: 200 }; // student in batch B

  beforeEach(async () => {
    mockPrisma = {
      students: { findUnique: jest.fn() },
      alumni_members: { findUnique: jest.fn() },
      alumni_group_messages: {
        findMany: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeAlumniMessagesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MeAlumniMessagesService>(MeAlumniMessagesService);
  });

  describe('listMessages — batch isolation', () => {
    it('always filters by the caller’s own resolved batch, never a client-supplied one', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(memberBatchA);
      mockPrisma.alumni_group_messages.findMany.mockResolvedValue([]);
      mockPrisma.alumni_group_messages.count.mockResolvedValue(0);

      const dto = Object.assign(new PaginationDto(), { page: 1, limit: 20 });
      await service.listMessages(1, dto);

      expect(mockPrisma.alumni_group_messages.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { alumni_batch_id: 100 } }),
      );
      expect(mockPrisma.alumni_group_messages.count).toHaveBeenCalledWith({
        where: { alumni_batch_id: 100 },
      });
    });

    it('throws 403 for a caller with no alumni_members row', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(null);

      await expect(
        service.listMessages(1, new PaginationDto()),
      ).rejects.toThrow(ForbiddenException);
    });

    it('resolves posted_by_name from soa_applications, falling back to email', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(memberBatchA);
      mockPrisma.alumni_group_messages.findMany.mockResolvedValue([
        {
          id: 1,
          alumni_batch_id: 100,
          posted_by_alumni_member_id: 1,
          content: 'hello',
          attachment_url: null,
          created_at: new Date('2026-01-01'),
          alumni_members: {
            students: {
              id: 10,
              users: { email: 'x@eos.test' },
              soa_applications: null,
            },
          },
        },
      ]);
      mockPrisma.alumni_group_messages.count.mockResolvedValue(1);

      const result = await service.listMessages(1, new PaginationDto());

      expect(result.data[0]).toEqual(
        expect.objectContaining({ posted_by_name: 'x@eos.test' }),
      );
      expect(result.data[0]).not.toHaveProperty('alumni_members');
    });
  });

  describe('createMessage — batch isolation', () => {
    it('always inserts with the caller’s own resolved batch and member id', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(memberBatchB);
      mockPrisma.alumni_group_messages.create.mockResolvedValue({ id: 99 });

      await service.createMessage(1, { content: 'hi everyone' });

      expect(mockPrisma.alumni_group_messages.create).toHaveBeenCalledWith({
        data: {
          alumni_batch_id: 200, // batch B, resolved server-side — never client-supplied
          posted_by_alumni_member_id: 2,
          content: 'hi everyone',
          attachment_url: undefined,
        },
      });
    });
  });

  describe('deleteMessage — ownership / cross-batch isolation', () => {
    it('404s when the message does not exist', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(memberBatchA);
      mockPrisma.alumni_group_messages.findUnique.mockResolvedValue(null);

      await expect(service.deleteMessage(1, 999)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('403s a member of batch A deleting a message posted in batch B, even knowing its id', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(memberBatchA); // caller is in batch A
      mockPrisma.alumni_group_messages.findUnique.mockResolvedValue({
        id: 55,
        alumni_batch_id: 200, // message belongs to batch B
        posted_by_alumni_member_id: 2, // posted by memberBatchB, not the caller
      });

      await expect(service.deleteMessage(1, 55)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.alumni_group_messages.delete).not.toHaveBeenCalled();
    });

    it('403s deleting someone else’s message within the caller’s own batch too', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(memberBatchA);
      mockPrisma.alumni_group_messages.findUnique.mockResolvedValue({
        id: 56,
        alumni_batch_id: 100,
        posted_by_alumni_member_id: 3, // a different member, same batch
      });

      await expect(service.deleteMessage(1, 56)).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockPrisma.alumni_group_messages.delete).not.toHaveBeenCalled();
    });

    it('allows deleting your own message', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(memberBatchA);
      mockPrisma.alumni_group_messages.findUnique.mockResolvedValue({
        id: 57,
        alumni_batch_id: 100,
        posted_by_alumni_member_id: 1,
      });
      mockPrisma.alumni_group_messages.delete.mockResolvedValue({});

      const result = await service.deleteMessage(1, 57);

      expect(mockPrisma.alumni_group_messages.delete).toHaveBeenCalledWith({
        where: { id: 57 },
      });
      expect(result).toEqual({ id: 57 });
    });
  });
});
