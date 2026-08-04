import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { MeAlumniGroupService } from './me-alumni-group.service';
import { PrismaService } from 'src/prisma/prisma.service';

jest.mock('src/prisma/prisma.service', () => ({
  PrismaService: class PrismaServiceMock {},
}));

describe('MeAlumniGroupService', () => {
  let service: MeAlumniGroupService;
  let mockPrisma: any;

  beforeEach(async () => {
    mockPrisma = {
      students: { findUnique: jest.fn() },
      alumni_members: { findUnique: jest.fn(), update: jest.fn() },
      alumni_batches: { findUnique: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MeAlumniGroupService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MeAlumniGroupService>(MeAlumniGroupService);
  });

  describe('getOwnGroup', () => {
    it('throws 404 when the caller has no student record', async () => {
      mockPrisma.students.findUnique.mockResolvedValue(null);

      await expect(service.getOwnGroup(1)).rejects.toThrow(NotFoundException);
    });

    it('throws 403 when the caller is a student but not an alumnus', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(null);

      await expect(service.getOwnGroup(1)).rejects.toThrow(ForbiddenException);
    });

    it('returns the batch and roster, preferring soa_applications name then falling back to email', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue({
        id: 1,
        alumni_batch_id: 7,
      });
      mockPrisma.alumni_batches.findUnique.mockResolvedValue({
        id: 7,
        batch_id: 3,
        group_name: 'AI&DS 2022-2026 Alumni',
        graduated_on: new Date('2026-05-01'),
        batches: { id: 3, name: '2022-2026' },
        alumni_members: [
          {
            id: 1,
            student_id: 10,
            personal_email: 'a@x.com',
            personal_phone: null,
            current_company: null,
            designation: null,
            status: 'active',
            students: {
              id: 10,
              student_id_no: 'S001',
              users: { email: 'user10@eos.test' },
              soa_applications: { first_name: 'Ada', last_name: 'Lovelace' },
            },
          },
          {
            id: 2,
            student_id: 11,
            personal_email: null,
            personal_phone: null,
            current_company: null,
            designation: null,
            status: 'active',
            students: {
              id: 11,
              student_id_no: 'S002',
              users: { email: 'user11@eos.test' },
              soa_applications: null,
            },
          },
        ],
      });

      const result = await service.getOwnGroup(1);

      expect(result.group_name).toBe('AI&DS 2022-2026 Alumni');
      expect(result.members).toEqual([
        expect.objectContaining({ student_id: 10, name: 'Ada Lovelace' }),
        expect.objectContaining({ student_id: 11, name: 'user11@eos.test' }),
      ]);
    });
  });

  describe('updateOwnProfile', () => {
    it('throws 403 when the caller is not an alumnus', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue(null);

      await expect(
        service.updateOwnProfile(1, { current_company: 'Acme' }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockPrisma.alumni_members.update).not.toHaveBeenCalled();
    });

    it('updates only the caller’s own alumni_members row', async () => {
      mockPrisma.students.findUnique.mockResolvedValue({ id: 10 });
      mockPrisma.alumni_members.findUnique.mockResolvedValue({
        id: 1,
        alumni_batch_id: 7,
      });
      mockPrisma.alumni_members.update.mockResolvedValue({ id: 1 });

      await service.updateOwnProfile(1, {
        current_company: 'Acme',
        designation: 'Engineer',
      });

      expect(mockPrisma.alumni_members.update).toHaveBeenCalledWith({
        where: { id: 1 },
        data: {
          personal_email: undefined,
          personal_phone: undefined,
          current_company: 'Acme',
          designation: 'Engineer',
        },
      });
    });
  });
});
