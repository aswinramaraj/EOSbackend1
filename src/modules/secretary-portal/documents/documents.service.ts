import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { CreateDocumentDto } from './dto/create-document.dto';
import { ListDocumentsQueryDto } from './dto/list-documents-query.dto';

const DOCUMENT_SELECT = {
  id: true,
  name: true,
  category: true,
  file_url: true,
  size_bytes: true,
  status: true,
  version: true,
  verified_at: true,
  created_at: true,
  updated_at: true,
  departments: { select: { id: true, name: true, code: true } },
  users_department_documents_uploaded_by_user_idTousers: { select: { id: true, email: true } },
  users_department_documents_verified_by_user_idTousers: { select: { id: true, email: true } },
} as const;

function toResponse(row: {
  id: number;
  name: string;
  category: string;
  file_url: string | null;
  size_bytes: bigint | null;
  status: string;
  version: number;
  verified_at: Date | null;
  created_at: Date;
  updated_at: Date;
  departments: { id: number; name: string; code: string };
  users_department_documents_uploaded_by_user_idTousers: { id: number; email: string };
  users_department_documents_verified_by_user_idTousers: { id: number; email: string } | null;
}) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    file_url: row.file_url,
    size_bytes: row.size_bytes !== null ? Number(row.size_bytes) : null,
    status: row.status,
    version: row.version,
    verified_at: row.verified_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    department: row.departments,
    uploaded_by: row.users_department_documents_uploaded_by_user_idTousers,
    verified_by: row.users_department_documents_verified_by_user_idTousers,
  };
}

/**
 * Department-wide document register — Secretary Portal "Department Document
 * Management" screen. Institution-wide visibility for Secretary/Admin/
 * Principal (no secretary→department table exists anywhere in the schema,
 * same posture as every other Secretary-facing module this session).
 */
@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateDocumentDto, userId: number) {
    const department = await this.prisma.departments.findUnique({ where: { id: dto.department_id } });
    if (!department) {
      throw new NotFoundException({ message: 'Department not found', errorCode: 'DEPARTMENT_NOT_FOUND' });
    }

    try {
      const row = await this.prisma.department_documents.create({
        data: {
          department_id: dto.department_id,
          name: dto.name,
          category: dto.category,
          file_url: dto.file_url,
          size_bytes: dto.size_bytes !== undefined ? BigInt(dto.size_bytes) : undefined,
          status: 'pending',
          uploaded_by_user_id: userId,
        },
        select: DOCUMENT_SELECT,
      });
      return toResponse(row);
    } catch (err) {
      this.logger.error('DB error creating department document', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async findAll(query: ListDocumentsQueryDto) {
    const where: Record<string, unknown> = {
      department_id: query.department_id,
      status: query.status,
      category: query.category,
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.department_documents.findMany({
        where,
        skip: query.skip,
        take: query.limit,
        orderBy: { created_at: 'desc' },
        select: DOCUMENT_SELECT,
      }),
      this.prisma.department_documents.count({ where }),
    ]);

    return paginate(rows.map(toResponse), total, query);
  }

  async findOne(id: number) {
    const row = await this.prisma.department_documents.findUnique({ where: { id }, select: DOCUMENT_SELECT });
    if (!row) {
      throw new NotFoundException({ message: 'Document not found', errorCode: 'DOCUMENT_NOT_FOUND' });
    }
    return toResponse(row);
  }

  /** PATCH /me/department-documents/:id/verify — toggles verified/pending, bumping version on each verify. */
  async toggleVerify(id: number, userId: number) {
    const existing = await this.prisma.department_documents.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Document not found', errorCode: 'DOCUMENT_NOT_FOUND' });
    }

    const nextStatus = existing.status === 'verified' ? 'pending' : 'verified';
    const row = await this.prisma.department_documents.update({
      where: { id },
      data: {
        status: nextStatus,
        version: nextStatus === 'verified' ? existing.version + 1 : existing.version,
        verified_by_user_id: nextStatus === 'verified' ? userId : null,
        verified_at: nextStatus === 'verified' ? new Date() : null,
        updated_at: new Date(),
      },
      select: DOCUMENT_SELECT,
    });
    return toResponse(row);
  }

  /** Institution-wide shared register — any Secretary/Admin/Principal may
   * remove any document, same as the register itself has no per-uploader
   * ownership concept in the design (a shared department office register). */
  async remove(id: number) {
    const existing = await this.prisma.department_documents.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Document not found', errorCode: 'DOCUMENT_NOT_FOUND' });
    }
    await this.prisma.department_documents.delete({ where: { id } });
    return { id, deleted: true };
  }
}
