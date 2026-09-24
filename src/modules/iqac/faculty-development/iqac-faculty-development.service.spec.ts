jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

jest.mock('src/common/db/publications-table.util', () => ({
  getPublicationsTable: jest.fn(),
  hasPublicationContributors: jest.fn(),
  getResearchProjectsTable: jest.fn(),
  getResearchMembersTable: jest.fn(),
  getPatentsTable: jest.fn(),
  getPatentInventorsTable: jest.fn(),
  researchAcceptsStudents: jest.fn(),
  patentsAcceptStudents: jest.fn(),
}));

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  getPatentInventorsTable,
  getPatentsTable,
  getPublicationsTable,
  getResearchMembersTable,
  getResearchProjectsTable,
  hasPublicationContributors,
  patentsAcceptStudents,
  researchAcceptsStudents,
} from 'src/common/db/publications-table.util';
import { IqacFacultyDevelopmentService } from './iqac-faculty-development.service';
import type { AddPublicationEntryDto } from './dto/add-publication-entry.dto';
import type { AddResearchEntryDto } from './dto/add-research-entry.dto';
import type { AddPatentEntryDto } from './dto/add-patent-entry.dto';

describe('IqacFacultyDevelopmentService — publications/research/patents', () => {
  let service: IqacFacultyDevelopmentService;
  let prisma: {
    $queryRawUnsafe: jest.Mock;
    $executeRawUnsafe: jest.Mock;
    $transaction: jest.Mock;
    iqac_metric_targets: { findUnique: jest.Mock };
  };

  const mockGetPublicationsTable = getPublicationsTable as jest.Mock;
  const mockHasPublicationContributors =
    hasPublicationContributors as jest.Mock;
  const mockGetResearchProjectsTable = getResearchProjectsTable as jest.Mock;
  const mockGetResearchMembersTable = getResearchMembersTable as jest.Mock;
  const mockGetPatentsTable = getPatentsTable as jest.Mock;
  const mockGetPatentInventorsTable = getPatentInventorsTable as jest.Mock;
  const mockResearchAcceptsStudents = researchAcceptsStudents as jest.Mock;
  const mockPatentsAcceptStudents = patentsAcceptStudents as jest.Mock;

  beforeEach(async () => {
    prisma = {
      $queryRawUnsafe: jest.fn(),
      $executeRawUnsafe: jest.fn(),
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
      iqac_metric_targets: { findUnique: jest.fn() },
    };
    mockGetPublicationsTable.mockReset().mockResolvedValue('publications');
    mockHasPublicationContributors.mockReset().mockResolvedValue(true);
    mockGetResearchProjectsTable
      .mockReset()
      .mockResolvedValue('research_projects');
    mockGetResearchMembersTable
      .mockReset()
      .mockResolvedValue('research_project_members');
    mockGetPatentsTable.mockReset().mockResolvedValue('patents');
    mockGetPatentInventorsTable
      .mockReset()
      .mockResolvedValue('patent_inventors');
    mockResearchAcceptsStudents.mockReset().mockResolvedValue(true);
    mockPatentsAcceptStudents.mockReset().mockResolvedValue(true);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IqacFacultyDevelopmentService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(IqacFacultyDevelopmentService);
  });

  describe('addPublicationEntry', () => {
    const dto: AddPublicationEntryDto = {
      title: 'A study of things',
      venue: 'IEEE Access',
      indexing: 'Scopus',
      published_date: undefined,
      contributors: [
        { type: 'faculty', id: 11, role: 'primary_author' },
        { type: 'student', id: 22, role: 'secondary_author' },
      ],
    };

    it('rejects with a clear error when publication_contributors has not been migrated yet', async () => {
      mockHasPublicationContributors.mockResolvedValue(false);

      await expect(service.addPublicationEntry(dto)).rejects.toMatchObject({
        response: { errorCode: 'PUBLICATION_CONTRIBUTORS_NOT_MIGRATED' },
      });
      await expect(service.addPublicationEntry(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('creates the publication row and one contributor row per submitted contributor, mixing faculty and student', async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ id: 501 }]) // INSERT ... RETURNING id
        .mockResolvedValueOnce([
          {
            id: 501,
            title: dto.title,
            type: 'journal',
            year: null,
            venue: dto.venue,
            doi: null,
            citation_count: 0,
            indexing: dto.indexing,
            published_date: null,
            status: null,
          },
        ]) // loadPublicationWithContributors: base row
        .mockResolvedValueOnce([
          {
            type: 'faculty',
            person_id: 11,
            name: 'Jane Doe',
            role: 'primary_author',
          },
          {
            type: 'student',
            person_id: 22,
            name: 'John Roe',
            role: 'secondary_author',
          },
        ]); // loadPublicationWithContributors: contributors

      const result = await service.addPublicationEntry(dto);

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledTimes(2);
      expect(prisma.$executeRawUnsafe).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining('INSERT INTO publication_contributors'),
        501,
        11,
        null,
        'primary_author',
      );
      expect(prisma.$executeRawUnsafe).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO publication_contributors'),
        501,
        null,
        22,
        'secondary_author',
      );
      expect(result).toMatchObject({
        id: 501,
        contributors: [
          { type: 'faculty', id: 11, name: 'Jane Doe', role: 'primary_author' },
          {
            type: 'student',
            id: 22,
            name: 'John Roe',
            role: 'secondary_author',
          },
        ],
      });
    });
  });

  describe('updatePublicationEntry', () => {
    it('throws NotFoundException when the publication does not exist', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]); // existence check returns nothing

      await expect(
        service.updatePublicationEntry(999, { title: 'New title' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a contributor-list change when the migration has not run, even though the publication exists', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 501 }]); // existence check succeeds
      mockHasPublicationContributors.mockResolvedValue(false);

      await expect(
        service.updatePublicationEntry(501, {
          contributors: [{ type: 'faculty', id: 11, role: 'primary_author' }],
        }),
      ).rejects.toMatchObject({
        response: { errorCode: 'PUBLICATION_CONTRIBUTORS_NOT_MIGRATED' },
      });
    });

    it('replaces the full contributor list inside the same transaction when contributors are provided', async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([{ id: 501 }]) // existence check
        .mockResolvedValueOnce([
          {
            id: 501,
            title: 'Updated',
            type: 'journal',
            year: null,
            venue: null,
            doi: null,
            citation_count: 0,
            indexing: null,
            published_date: null,
            status: null,
          },
        ])
        .mockResolvedValueOnce([
          {
            type: 'faculty',
            person_id: 33,
            name: 'New Author',
            role: 'primary_author',
          },
        ]);

      await service.updatePublicationEntry(501, {
        title: 'Updated',
        contributors: [{ type: 'faculty', id: 33, role: 'primary_author' }],
      });

      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM publication_contributors'),
        501,
      );
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO publication_contributors'),
        501,
        33,
        null,
        'primary_author',
      );
    });
  });

  describe('removePublicationEntry', () => {
    it('throws NotFoundException when the publication does not exist', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([]);
      await expect(service.removePublicationEntry(999)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('deletes the row when it exists', async () => {
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 501 }]);
      const result = await service.removePublicationEntry(501);
      expect(result).toEqual({ id: 501, deleted: true });
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('DELETE FROM publications'),
        501,
      );
    });
  });

  describe('addResearchEntry', () => {
    const dto: AddResearchEntryDto = {
      centre_name: 'Centre for AI Research',
      focus_area: 'Computer Vision',
      joined_on: '2026-01-15',
      contributors: [
        { type: 'faculty', id: 11, role: 'Principal Investigator' },
        { type: 'student', id: 22, role: 'Team Member' },
      ],
    };

    it('rejects a student contributor with a clear error when the migration has not run', async () => {
      mockResearchAcceptsStudents.mockResolvedValue(false);
      prisma.$queryRawUnsafe.mockResolvedValue([{ id: 900 }]); // existing project found by centre_name, on every call

      await expect(service.addResearchEntry(dto)).rejects.toMatchObject({
        response: { errorCode: 'RESEARCH_STUDENTS_NOT_MIGRATED' },
      });
      await expect(service.addResearchEntry(dto)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('still allows a faculty-only submission when the migration has not run', async () => {
      mockResearchAcceptsStudents.mockResolvedValue(false);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 900 }]);

      const facultyOnlyDto: AddResearchEntryDto = {
        ...dto,
        contributors: [dto.contributors[0]],
      };
      const result = await service.addResearchEntry(facultyOnlyDto);

      expect(result).toEqual({ project_id: 900, added: 1 });
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO research_project_members'),
        900,
        11,
        'Principal Investigator',
        dto.joined_on,
      );
    });

    it('creates the project (find-or-create by centre_name) and inserts one membership row per contributor, mixing faculty and student', async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // no existing project
        .mockResolvedValueOnce([{ id: 901 }]); // INSERT ... RETURNING id

      const result = await service.addResearchEntry(dto);

      expect(prisma.$queryRawUnsafe).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO research_projects'),
        dto.centre_name,
        dto.focus_area,
      );
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO research_project_members'),
        901,
        11,
        'Principal Investigator',
        dto.joined_on,
      );
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO research_project_members'),
        901,
        22,
        'Team Member',
        dto.joined_on,
      );
      expect(result).toEqual({ project_id: 901, added: 2 });
    });
  });

  describe('addPatentEntry', () => {
    const dto: AddPatentEntryDto = {
      title: 'A Method for Real-Time Traffic Prediction',
      stage: 'filed',
      filed_year: 2026,
      contributors: [
        { type: 'faculty', id: 11, role: 'Inventor' },
        { type: 'student', id: 22, role: 'Co-inventor' },
      ],
    };

    it('rejects a student contributor with a clear error when the migration has not run', async () => {
      mockPatentsAcceptStudents.mockResolvedValue(false);
      prisma.$queryRawUnsafe.mockResolvedValueOnce([{ id: 700 }]); // existing patent found by title

      await expect(service.addPatentEntry(dto)).rejects.toMatchObject({
        response: { errorCode: 'PATENT_STUDENTS_NOT_MIGRATED' },
      });
      expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    });

    it('creates the patent (find-or-create by title) and inserts one inventorship row per contributor, mixing faculty and student', async () => {
      prisma.$queryRawUnsafe
        .mockResolvedValueOnce([]) // no existing patent
        .mockResolvedValueOnce([{ id: 701 }]); // INSERT ... RETURNING id

      const result = await service.addPatentEntry(dto);

      expect(prisma.$queryRawUnsafe).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining('INSERT INTO patents'),
        dto.title,
        dto.stage,
        dto.filed_year,
        null,
      );
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO patent_inventors'),
        701,
        11,
        'Inventor',
      );
      expect(prisma.$executeRawUnsafe).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO patent_inventors'),
        701,
        22,
        'Co-inventor',
      );
      expect(result).toEqual({ patent_id: 701, added: 2 });
    });
  });
});
