import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate } from 'src/common/dto/pagination.dto';
import { StorageService } from 'src/common/storage/storage.service';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
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
  users_department_documents_uploaded_by_user_idTousers: {
    select: { id: true, email: true },
  },
  users_department_documents_verified_by_user_idTousers: {
    select: { id: true, email: true },
  },
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
  users_department_documents_uploaded_by_user_idTousers: {
    id: number;
    email: string;
  };
  users_department_documents_verified_by_user_idTousers: {
    id: number;
    email: string;
  } | null;
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Secretary is always forced to her own department; other roles keep whatever was requested (or none = institution-wide). */
  private async resolveEffectiveDepartmentId(
    user: JwtPayload,
    requested?: number,
  ): Promise<number | undefined> {
    if (user.role !== ROLES.SECRETARY) return requested;
    const staff = await this.prisma.non_teaching_staff.findFirst({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!staff?.department_id) {
      throw new ForbiddenException({
        message: 'No department is assigned to this secretary account',
        errorCode: 'SECRETARY_NO_DEPARTMENT',
      });
    }
    return staff.department_id;
  }

  /** A Secretary may only act on documents belonging to her own department — other roles are unrestricted. */
  private async assertDepartmentAccess(user: JwtPayload, documentDepartmentId: number): Promise<void> {
    if (user.role !== ROLES.SECRETARY) return;
    const staff = await this.prisma.non_teaching_staff.findFirst({
      where: { user_id: user.sub },
      select: { department_id: true },
    });
    if (!staff?.department_id || staff.department_id !== documentDepartmentId) {
      throw new ForbiddenException({
        message: 'You may only act on documents from your own department',
        errorCode: 'FORBIDDEN_DEPARTMENT',
      });
    }
  }

  /**
   * POST /me/department-documents/attachments — real file upload, same
   * Supabase-Storage pattern as announcements/media-requests. Returns
   * { url, size_bytes } which the composer sends back as file_url/
   * size_bytes on the actual create() call — replaces the previous
   * hand-typed "size in MB" field with the real uploaded file's size.
   */
  async uploadAttachment(file: Express.Multer.File) {
    const { key } = await this.storage.upload(
      'department-documents',
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    const url = this.storage.getPublicUrl(key);
    return {
      file_key: key,
      file_name: file.originalname,
      url,
      size_bytes: file.size,
    };
  }

  async create(user: JwtPayload, dto: CreateDocumentDto, userId: number) {
    const effectiveDepartmentId = (await this.resolveEffectiveDepartmentId(user, dto.department_id))!;
    const department = await this.prisma.departments.findUnique({
      where: { id: effectiveDepartmentId },
    });
    if (!department) {
      throw new NotFoundException({
        message: 'Department not found',
        errorCode: 'DEPARTMENT_NOT_FOUND',
      });
    }

    try {
      const row = await this.prisma.department_documents.create({
        data: {
          department_id: effectiveDepartmentId,
          name: dto.name,
          category: dto.category,
          file_url: dto.file_url,
          size_bytes:
            dto.size_bytes !== undefined ? BigInt(dto.size_bytes) : undefined,
          status: 'pending',
          uploaded_by_user_id: userId,
        },
        select: DOCUMENT_SELECT,
      });
      return toResponse(row);
    } catch (err) {
      this.logger.error('DB error creating department document', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async findAll(user: JwtPayload, query: ListDocumentsQueryDto) {
    const effectiveDepartmentId = await this.resolveEffectiveDepartmentId(user, query.department_id);
    const where: Record<string, unknown> = {
      department_id: effectiveDepartmentId,
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

  async findOne(user: JwtPayload, id: number) {
    const row = await this.prisma.department_documents.findUnique({
      where: { id },
      select: DOCUMENT_SELECT,
    });
    if (!row) {
      throw new NotFoundException({
        message: 'Document not found',
        errorCode: 'DOCUMENT_NOT_FOUND',
      });
    }
    await this.assertDepartmentAccess(user, row.departments.id);
    return toResponse(row);
  }

  /** PATCH /me/department-documents/:id/verify — toggles verified/pending, bumping version on each verify. */
  async toggleVerify(user: JwtPayload, id: number, userId: number) {
    const existing = await this.prisma.department_documents.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Document not found',
        errorCode: 'DOCUMENT_NOT_FOUND',
      });
    }
    await this.assertDepartmentAccess(user, existing.department_id);
    if (existing.status === 'missing') {
      throw new BadRequestException({
        message:
          'This document has not been submitted yet — nothing to verify.',
        errorCode: 'DOCUMENT_MISSING',
      });
    }

    const nextStatus = existing.status === 'verified' ? 'pending' : 'verified';
    const row = await this.prisma.department_documents.update({
      where: { id },
      data: {
        status: nextStatus,
        version:
          nextStatus === 'verified' ? existing.version + 1 : existing.version,
        verified_by_user_id: nextStatus === 'verified' ? userId : null,
        verified_at: nextStatus === 'verified' ? new Date() : null,
        updated_at: new Date(),
      },
      select: DOCUMENT_SELECT,
    });
    return toResponse(row);
  }

  /** Admin/Principal may remove any document (shared register, no per-uploader
   * ownership concept); a Secretary may only remove her own department's. */
  async remove(user: JwtPayload, id: number) {
    const existing = await this.prisma.department_documents.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Document not found',
        errorCode: 'DOCUMENT_NOT_FOUND',
      });
    }
    await this.assertDepartmentAccess(user, existing.department_id);
    await this.prisma.department_documents.delete({ where: { id } });
    return { id, deleted: true };
  }
}
