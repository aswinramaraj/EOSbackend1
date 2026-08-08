jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/modules/storage/storage.service';
import { AppraisalService } from './appraisal.service';

describe('AppraisalService', () => {
  let service: AppraisalService;
  let prisma: {
    faculty: { findUnique: jest.Mock };
    appraisal_criteria: { findMany: jest.Mock };
    appraisal_divisions: { findUnique: jest.Mock };
    appraisal_requests: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    appraisal_entries: {
      createMany: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    appraisal_attachments: {
      createMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let storage: { upload: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    prisma = {
      faculty: { findUnique: jest.fn() },
      appraisal_criteria: { findMany: jest.fn() },
      appraisal_divisions: { findUnique: jest.fn() },
      appraisal_requests: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      appraisal_entries: {
        createMany: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      appraisal_attachments: {
        createMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    storage = { upload: jest.fn(), remove: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AppraisalService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: storage },
      ],
    }).compile();

    service = module.get<AppraisalService>(AppraisalService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('addAttachments', () => {
    it('throws 404 when the JWT user has no linked faculty record', async () => {
      prisma.faculty.findUnique.mockResolvedValue(null);

      await expect(
        service.addAttachments(1, 1, [], 999),
      ).rejects.toThrow('Faculty profile not found for the authenticated user');
    });

    it('throws 403 when the request does not belong to the caller', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 999,
        status: 'submitted',
      });

      await expect(
        service.addAttachments(1, 1, [], 1),
      ).rejects.toThrow('You may only attach files to your own appraisal requests');
    });

    it('throws 409 when the request is no longer submitted', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'hod_reviewed',
      });

      await expect(
        service.addAttachments(1, 1, [], 1),
      ).rejects.toThrow('Files can only be attached while the request is still in the submitted stage');
    });

    it('throws 404 when the division does not exist', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
      });
      prisma.appraisal_divisions.findUnique.mockResolvedValue(null);

      await expect(
        service.addAttachments(1, 1, [], 1),
      ).rejects.toThrow('Appraisal division not found');
    });

    it('uploads each file to storage and persists an attachment row per file', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
      });
      prisma.appraisal_divisions.findUnique.mockResolvedValue({ id: 1, name: 'Teaching Effectiveness' });
      storage.upload
        .mockResolvedValueOnce({ url: 'https://example.com/a.pdf', path: '1/1/a.pdf' })
        .mockResolvedValueOnce({ url: 'https://example.com/b.pdf', path: '1/1/b.pdf' });
      prisma.appraisal_requests.findUniqueOrThrow.mockResolvedValue({
        id: 1,
        academic_year: '2025-2026',
        status: 'submitted',
        hod_reviewed_at: null,
        management_approved_at: null,
        created_at: new Date(),
        faculty: { id: 5, first_name: 'A', last_name: 'B', designation: 'Prof' },
        users_appraisal_requests_hod_reviewed_byTousers: null,
        users_appraisal_requests_management_approved_byTousers: null,
        appraisal_entries: [],
        appraisal_attachments: [],
      });

      await service.addAttachments(
        1,
        1,
        [
          { buffer: Buffer.from('a'), originalname: 'a.pdf', mimetype: 'application/pdf' },
          { buffer: Buffer.from('b'), originalname: 'b.pdf', mimetype: 'application/pdf' },
        ] as any,
        1,
      );

      expect(storage.upload).toHaveBeenCalledTimes(2);
      expect(prisma.appraisal_attachments.createMany).toHaveBeenCalledWith({
        data: [
          expect.objectContaining({
            appraisal_request_id: 1,
            division_id: 1,
            file_url: 'https://example.com/a.pdf',
            file_name: 'a.pdf',
          }),
          expect.objectContaining({
            appraisal_request_id: 1,
            division_id: 1,
            file_url: 'https://example.com/b.pdf',
            file_name: 'b.pdf',
          }),
        ],
      });
    });
  });

  describe('removeAttachment', () => {
    it('throws 403 when the request does not belong to the caller', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 999,
        status: 'submitted',
      });

      await expect(
        service.removeAttachment(1, 1, 1),
      ).rejects.toThrow('You may only remove attachments from your own appraisal requests');
    });

    it('throws 409 when the request is no longer submitted', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'hr_scored',
      });

      await expect(
        service.removeAttachment(1, 1, 1),
      ).rejects.toThrow('Attachments can only be removed while the request is still in the submitted stage');
    });

    it('throws 404 when the attachment does not belong to this request', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
      });
      prisma.appraisal_attachments.findUnique.mockResolvedValue({
        id: 1,
        appraisal_request_id: 999,
        storage_path: 'x',
      });

      await expect(
        service.removeAttachment(1, 1, 1),
      ).rejects.toThrow('Attachment not found on this request');
    });

    it('deletes the DB row and removes the file from storage', async () => {
      prisma.faculty.findUnique.mockResolvedValue({ id: 5 });
      prisma.appraisal_requests.findUnique.mockResolvedValue({
        faculty_id: 5,
        status: 'submitted',
      });
      prisma.appraisal_attachments.findUnique.mockResolvedValue({
        id: 7,
        appraisal_request_id: 1,
        storage_path: '1/1/a.pdf',
      });

      const result = await service.removeAttachment(1, 7, 1);

      expect(prisma.appraisal_attachments.delete).toHaveBeenCalledWith({ where: { id: 7 } });
      expect(storage.remove).toHaveBeenCalledWith('1/1/a.pdf');
      expect(result).toEqual({ id: 7, deleted: true });
    });
  });
});
