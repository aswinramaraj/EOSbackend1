import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateEdcDocumentDto } from './dto/create-edc-document.dto';
import { ReviewEdcDocumentDto } from './dto/review-edc-document.dto';

const INCLUDE = {
  student_entrepreneurship: { select: { id: true, business_name: true } },
} as const;

/**
 * EDC Coordinator's "Documents" screen — real `edc_documents` table, added
 * this session. No generic document/attachment table existed before
 * (confirmed via a live DB audit) — the actual FILE upload reuses the
 * existing `POST /announcements/attachments` endpoint's Supabase Storage
 * plumbing (EDC_COORDINATOR already had access to it); this table only
 * records the resulting key/url/name against a venture plus the
 * verification workflow, mirroring `faculty_documents.verification_status`'s
 * precedent for a Pending/Verified/Rejected state.
 */
@Injectable()
export class EdcDocumentsService {
  private readonly logger = new Logger(EdcDocumentsService.name);

  constructor(private readonly prisma: PrismaService) {}

  private toResponse(row: any) {
    return {
      id: row.id,
      student_entrepreneurship_id: row.student_entrepreneurship_id,
      venture_name: row.student_entrepreneurship?.business_name ?? null,
      document_type: row.document_type,
      file_name: row.file_name,
      file_url: row.file_url,
      uploaded_at: row.uploaded_at,
      verification_status: row.verification_status,
      reviewer_note: row.reviewer_note,
      reviewed_at: row.reviewed_at,
    };
  }

  async findAll() {
    try {
      const rows = await this.prisma.edc_documents.findMany({
        include: INCLUDE,
        orderBy: { uploaded_at: 'desc' },
      });
      return rows.map((row) => this.toResponse(row));
    } catch (err) {
      this.logger.error('DB error listing edc_documents', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async create(dto: CreateEdcDocumentDto, uploadedByUserId: number) {
    if (dto.student_entrepreneurship_id !== undefined) {
      const venture = await this.prisma.student_entrepreneurship.findUnique({ where: { id: dto.student_entrepreneurship_id } });
      if (!venture) {
        throw new NotFoundException({ message: 'Venture not found', errorCode: 'VENTURE_NOT_FOUND' });
      }
    }
    try {
      const created = await this.prisma.edc_documents.create({
        data: {
          student_entrepreneurship_id: dto.student_entrepreneurship_id,
          document_type: dto.document_type,
          file_name: dto.file_name,
          file_url: dto.file_url,
          file_key: dto.file_key,
          uploaded_by_user_id: uploadedByUserId,
        },
        include: INCLUDE,
      });
      return this.toResponse(created);
    } catch (err) {
      this.logger.error('DB error creating edc_document', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  /** PATCH /me/edc-documents/:id/review — Verify/Reject with an optional note. */
  async review(id: number, dto: ReviewEdcDocumentDto, reviewerUserId: number) {
    const existing = await this.prisma.edc_documents.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Document not found', errorCode: 'DOCUMENT_NOT_FOUND' });
    }
    try {
      const updated = await this.prisma.edc_documents.update({
        where: { id },
        data: {
          verification_status: dto.verification_status,
          reviewer_note: dto.reviewer_note,
          reviewed_by_user_id: reviewerUserId,
          reviewed_at: new Date(),
        },
        include: INCLUDE,
      });
      return this.toResponse(updated);
    } catch (err) {
      this.logger.error('DB error reviewing edc_document', err);
      throw new InternalServerErrorException({ message: 'Something went wrong. Please try again.', errorCode: 'INTERNAL_ERROR' });
    }
  }

  async remove(id: number) {
    const existing = await this.prisma.edc_documents.findUnique({ where: { id } });
    if (!existing) {
      throw new NotFoundException({ message: 'Document not found', errorCode: 'DOCUMENT_NOT_FOUND' });
    }
    await this.prisma.edc_documents.delete({ where: { id } });
    return { id, deleted: true };
  }
}
