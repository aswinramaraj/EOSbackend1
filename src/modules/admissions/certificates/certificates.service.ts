import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { STORAGE_BUCKETS } from 'src/common/constants/storage-buckets.constant';
import { CreateCertificateDto } from './dto/create-certificate.dto';
import { UpdateCertificateDto } from './dto/update-certificate.dto';

const DOC_ACCEPT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];
const DOC_MAX_BYTES = 5 * 1024 * 1024; // 5 MB — matches the reference admission form's own limit

const CERTIFICATE_SELECT = {
  id: true,
  is_available: true,
  file_url: true,
  verified_at: true,
  certificate_types: { select: { name: true } },
} as const;

@Injectable()
export class CertificatesService {
  private readonly logger = new Logger(CertificatesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  private assertValidDocFile(file?: Express.Multer.File) {
    if (!file) return;
    if (!DOC_ACCEPT_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        message: `That file type is not accepted. PDF, JPG, PNG or WebP only — got ${file.mimetype || 'an unknown type'}.`,
        errorCode: 'INVALID_DOCUMENT_TYPE',
      });
    }
    if (file.size > DOC_MAX_BYTES) {
      throw new BadRequestException({
        message: `File is too large — the limit is ${DOC_MAX_BYTES / (1024 * 1024)}MB per document.`,
        errorCode: 'DOCUMENT_TOO_LARGE',
      });
    }
  }

  /**
   * GET /certificate-types — the checklist's real, DB-backed set of
   * document types (never a hardcoded list — see the reference form's own
   * comment: "In production this is SELECT id, name FROM certificate_types").
   */
  async listTypes() {
    return this.prisma.certificate_types.findMany({ orderBy: { id: 'asc' } });
  }

  /**
   * POST /certificates (multipart, ADMIN) — upsert-by-(student_id,
   * certificate_type_id), the same key student_certificates is uniquely
   * constrained on. Ticking "collected" and attaching a scan are two
   * separate facts (see the reference form's own doc comment) — a file is
   * optional; attaching one implies is_available unless explicitly
   * overridden to false.
   */
  async create(dto: CreateCertificateDto, file?: Express.Multer.File) {
    this.assertValidDocFile(file);

    const student = await this.prisma.students.findUnique({
      where: { id: dto.student_id },
      select: { id: true },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student not found',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }
    const certificateType = await this.prisma.certificate_types.findUnique({
      where: { id: dto.certificate_type_id },
      select: { id: true },
    });
    if (!certificateType) {
      throw new NotFoundException({
        message:
          'certificate_type_id does not reference an existing certificate type',
        errorCode: 'CERTIFICATE_TYPE_NOT_FOUND',
      });
    }

    // student_documents is a PRIVATE bucket — file_url stores the storage
    // KEY, never a resolved URL (which would need re-signing anyway once
    // its 1-hour TTL lapses). toResponse() below signs a fresh URL for
    // whoever's reading it right now.
    let storageKey: string | undefined;
    if (file) {
      const { key } = await this.storage.upload(
        `students/${dto.student_id}/certificates`,
        file.originalname,
        file.buffer,
        file.mimetype,
        STORAGE_BUCKETS.STUDENT_DOCUMENTS,
      );
      storageKey = key;
    }

    const isAvailable =
      dto.is_available !== undefined ? dto.is_available === 'true' : !!file;

    const data = {
      is_available: isAvailable,
      ...(storageKey ? { file_url: storageKey } : {}),
    };

    const row = await this.prisma.student_certificates.upsert({
      where: {
        student_id_certificate_type_id: {
          student_id: dto.student_id,
          certificate_type_id: dto.certificate_type_id,
        },
      },
      create: {
        student_id: dto.student_id,
        certificate_type_id: dto.certificate_type_id,
        ...data,
      },
      update: data,
      select: CERTIFICATE_SELECT,
    });
    return this.toResponse(row);
  }

  /** PATCH /certificates/:id (ADMIN) — toggle possession and/or verify/un-verify. */
  async update(id: number, dto: UpdateCertificateDto) {
    const existing = await this.prisma.student_certificates.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException({
        message: 'Certificate record not found',
        errorCode: 'CERTIFICATE_NOT_FOUND',
      });
    }

    const row = await this.prisma.student_certificates.update({
      where: { id },
      data: {
        ...(dto.is_available !== undefined
          ? { is_available: dto.is_available }
          : {}),
        ...(dto.verified !== undefined
          ? { verified_at: dto.verified ? new Date() : null }
          : {}),
      },
      select: CERTIFICATE_SELECT,
    });
    return this.toResponse(row);
  }

  /** Resolves a stored storage key into a fresh signed URL — see the field's own comment above. */
  private async toResponse(row: {
    id: number;
    is_available: boolean;
    file_url: string | null;
    verified_at: Date | null;
    certificate_types: { name: string } | null;
  }) {
    return {
      ...row,
      file_url: row.file_url
        ? await this.storage.getSignedDownloadUrl(
            row.file_url,
            STORAGE_BUCKETS.STUDENT_DOCUMENTS,
          )
        : null,
    };
  }
}
