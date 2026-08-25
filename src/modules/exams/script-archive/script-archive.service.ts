import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { ArchiveBundleDto } from './dto/archive-bundle.dto';
import { CreateRetrievalDto } from './dto/create-retrieval.dto';

const INCLUDE = {
  script_bundles: {
    include: { exam_subject_mapping: { select: { subjects: { select: { id: true, name: true, subject_code: true } } } } },
  },
  script_retrieval_requests: { where: { returned_at: null }, orderBy: { requested_at: 'desc' as const }, take: 1 },
} as const;

@Injectable()
export class ScriptArchiveService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll(status?: 'in_archive' | 'issued_out' | 'due_disposal') {
    const bundles = await this.prisma.script_archive_bundles.findMany({
      where: status ? { status } : {},
      include: INCLUDE,
      orderBy: { id: 'desc' },
    });

    return bundles.map((b) => ({
      id: b.id,
      bundle_code: b.script_bundles.bundle_code,
      subject: b.script_bundles.exam_subject_mapping.subjects,
      scripts_count: b.script_bundles.scripts_count,
      location_label: b.location_label,
      retention_until: b.retention_until,
      status: b.status,
      active_retrieval: b.script_retrieval_requests[0] ?? null,
    }));
  }

  async getStats() {
    const [total, inArchive, issuedOut, dueDisposal, retrievals] = await Promise.all([
      this.prisma.script_archive_bundles.count(),
      this.prisma.script_archive_bundles.count({ where: { status: 'in_archive' } }),
      this.prisma.script_archive_bundles.count({ where: { status: 'issued_out' } }),
      this.prisma.script_archive_bundles.count({ where: { status: 'due_disposal' } }),
      this.prisma.script_retrieval_requests.count(),
    ]);

    return { archived: total, in_archive: inArchive, issued_out: issuedOut, due_disposal: dueDisposal, retrieval_requests: retrievals };
  }

  async archiveBundle(dto: ArchiveBundleDto) {
    const bundle = await this.prisma.script_bundles.findUnique({ where: { id: dto.bundle_id } });
    if (!bundle) throw new NotFoundException({ message: 'Script bundle not found.', errorCode: 'BUNDLE_NOT_FOUND' });

    const existing = await this.prisma.script_archive_bundles.findUnique({ where: { bundle_id: dto.bundle_id } });
    if (existing) throw new ConflictException({ message: 'This bundle is already archived.', errorCode: 'ALREADY_ARCHIVED' });

    return this.prisma.script_archive_bundles.create({
      data: { bundle_id: dto.bundle_id, location_label: dto.location_label, retention_until: new Date(dto.retention_until) },
    });
  }

  async createRetrieval(dto: CreateRetrievalDto, requestedByUserId: number) {
    const archiveBundle = await this.prisma.script_archive_bundles.findUnique({ where: { id: dto.archive_bundle_id } });
    if (!archiveBundle) throw new NotFoundException({ message: 'Archived bundle not found.', errorCode: 'ARCHIVE_BUNDLE_NOT_FOUND' });

    const [retrieval] = await this.prisma.$transaction([
      this.prisma.script_retrieval_requests.create({
        data: { archive_bundle_id: dto.archive_bundle_id, requested_by_user_id: requestedByUserId, purpose: dto.purpose, issued_to: dto.issued_to },
      }),
      this.prisma.script_archive_bundles.update({ where: { id: dto.archive_bundle_id }, data: { status: 'issued_out' } }),
    ]);

    return retrieval;
  }

  async recall(archiveBundleId: number) {
    const archiveBundle = await this.prisma.script_archive_bundles.findUnique({ where: { id: archiveBundleId } });
    if (!archiveBundle) throw new NotFoundException({ message: 'Archived bundle not found.', errorCode: 'ARCHIVE_BUNDLE_NOT_FOUND' });

    const activeRetrieval = await this.prisma.script_retrieval_requests.findFirst({ where: { archive_bundle_id: archiveBundleId, returned_at: null } });

    await this.prisma.$transaction([
      ...(activeRetrieval ? [this.prisma.script_retrieval_requests.update({ where: { id: activeRetrieval.id }, data: { returned_at: new Date() } })] : []),
      this.prisma.script_archive_bundles.update({ where: { id: archiveBundleId }, data: { status: 'in_archive' } }),
    ]);

    return { id: archiveBundleId, status: 'in_archive' };
  }
}
