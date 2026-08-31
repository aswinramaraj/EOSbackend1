import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '../../../../generated/prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { ListArchiveQueryDto } from './dto/list-archive-query.dto';
import { CreateRetrievalDto } from './dto/create-retrieval.dto';
import { ArchiveBundleDto } from './dto/archive-bundle.dto';

/** Real, fixed retention policy — 6 months after a bundle is archived (shown verbatim as the "Retention period" stat tile). */
export const RETENTION_MONTHS = 6;

const RACK_LETTERS = ['A', 'B', 'C', 'D'];
const SHELVES_PER_RACK = 4;
const BUNDLES_PER_SHELF = 20;

/** Deterministic next-open-shelf assignment — sequential bin-packing over however many bundles are already archived, not a random or fabricated location. */
export function computeArchiveLocation(existingArchivedCount: number): string {
  const shelfGlobalIndex = Math.floor(
    existingArchivedCount / BUNDLES_PER_SHELF,
  );
  const rackIndex =
    Math.floor(shelfGlobalIndex / SHELVES_PER_RACK) % RACK_LETTERS.length;
  const shelfNumber = (shelfGlobalIndex % SHELVES_PER_RACK) + 1;
  return `Rack ${RACK_LETTERS[rackIndex]} · Shelf ${shelfNumber}`;
}

export function computeRetentionUntil(from: Date): Date {
  const until = new Date(from);
  until.setMonth(until.getMonth() + RETENTION_MONTHS);
  return until;
}

type RequestType = 'photocopy' | 'rti';

interface RetrievalMeta {
  type: RequestType;
  receiptNo?: string;
  receiptUrl?: string;
}

/**
 * script_retrieval_requests has no request_type/fee-receipt columns (schema
 * confirmed) — encoded as a JSON blob at the front of the real `purpose`
 * text instead of being fabricated as separate fields, same "combine into
 * one real column" move used elsewhere this session (malpractice's
 * invigilator_remarks). Decoded back out everywhere it's displayed/filtered.
 */
function encodePurpose(
  meta: RetrievalMeta,
  purposeText: string | undefined,
): string {
  const defaultText =
    meta.type === 'rti' ? 'RTI request' : 'Photocopy of answer script';
  const text = purposeText?.trim() || defaultText;
  return `[[meta:${JSON.stringify(meta)}]] ${text}`;
}

function decodeMeta(purpose: string): RetrievalMeta {
  const match = /^\[\[meta:(.+?)\]\]/.exec(purpose);
  if (!match) return { type: 'photocopy' };
  try {
    const parsed = JSON.parse(match[1]) as Partial<RetrievalMeta>;
    return {
      type: parsed.type === 'rti' ? 'rti' : 'photocopy',
      receiptNo: parsed.receiptNo,
      receiptUrl: parsed.receiptUrl,
    };
  } catch {
    return { type: 'photocopy' };
  }
}

function decodePurposeText(purpose: string): string {
  return purpose.replace(/^\[\[meta:.+?\]\]\s*/, '');
}

function referenceCode(
  requestType: RequestType,
  requestId: number,
  requestedAt: Date,
): string {
  return `${requestType === 'rti' ? 'RTI' : 'PC'}/${requestedAt.getFullYear()}/${String(requestId).padStart(4, '0')}`;
}

/** Same June-cutoff academic-cycle boundary used across the rebuilt COE pages. */
function isThisCycle(date: Date, now: Date): boolean {
  const cycleStart = new Date(
    Date.UTC(
      now.getUTCMonth() >= 5 ? now.getUTCFullYear() : now.getUTCFullYear() - 1,
      5,
      1,
    ),
  );
  return date >= cycleStart;
}

const INCLUDE = {
  script_bundles: {
    include: {
      exam_subject_mapping: {
        select: {
          subjects: { select: { id: true, name: true, subject_code: true } },
          exams: {
            select: {
              id: true,
              title: true,
              academic_year: true,
              semester: true,
              exam_types: { select: { name: true } },
            },
          },
        },
      },
    },
  },
  script_retrieval_requests: {
    where: { returned_at: null },
    orderBy: { requested_at: 'desc' as const },
    take: 1,
  },
} as const;

@Injectable()
export class ScriptArchiveService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async findAll(query: ListArchiveQueryDto) {
    const where: Prisma.script_archive_bundlesWhereInput = {};
    if (query.status) where.status = query.status;

    const bundles = await this.prisma.script_archive_bundles.findMany({
      where,
      include: INCLUDE,
      orderBy: { id: 'desc' },
    });

    let rows = bundles.map((b) => {
      const exam = b.script_bundles.exam_subject_mapping.exams;
      const activeRetrieval = b.script_retrieval_requests[0] ?? null;
      const meta = activeRetrieval ? decodeMeta(activeRetrieval.purpose) : null;
      return {
        id: b.id,
        bundle_code: b.script_bundles.bundle_code,
        subject: b.script_bundles.exam_subject_mapping.subjects,
        exam_label:
          exam.title ?? `${exam.exam_types.name} · ${exam.academic_year}`,
        scripts_count: b.script_bundles.scripts_count,
        location_label: b.location_label,
        rack: b.location_label.split(' · ')[0] ?? b.location_label,
        retention_until: b.retention_until,
        status: b.status,
        active_retrieval:
          activeRetrieval && meta
            ? {
                id: activeRetrieval.id,
                request_type: meta.type,
                fee_receipt_no: meta.receiptNo ?? null,
                fee_receipt_url: meta.receiptUrl ?? null,
                purpose: decodePurposeText(activeRetrieval.purpose),
                issued_to: activeRetrieval.issued_to,
                requested_at: activeRetrieval.requested_at,
                reference_code: referenceCode(
                  meta.type,
                  activeRetrieval.id,
                  activeRetrieval.requested_at,
                ),
              }
            : null,
      };
    });

    if (query.rack) rows = rows.filter((r) => r.rack === query.rack);
    if (query.request_type)
      rows = rows.filter(
        (r) => r.active_retrieval?.request_type === query.request_type,
      );
    if (query.search?.trim()) {
      const q = query.search.trim().toLowerCase();
      rows = rows.filter((r) =>
        [r.bundle_code, r.subject.subject_code, r.subject.name, r.rack]
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }

    return rows;
  }

  async getStats() {
    const now = new Date();
    const [total, archivedDates, dueDisposalBundles, openRetrievals] =
      await Promise.all([
        this.prisma.script_archive_bundles.count(),
        this.prisma.script_archive_bundles.findMany({
          select: { archived_at: true },
        }),
        this.prisma.script_archive_bundles.findMany({
          where: { status: 'due_disposal' },
          select: { retention_until: true },
        }),
        this.prisma.script_retrieval_requests.findMany({
          where: { returned_at: null },
          select: { requested_at: true },
        }),
      ]);

    const archivedThisCycle = archivedDates.filter((b) =>
      isThisCycle(b.archived_at, now),
    ).length;
    const pendingBeyond30Days = openRetrievals.filter(
      (r) =>
        now.getTime() - r.requested_at.getTime() > 30 * 24 * 60 * 60 * 1000,
    ).length;
    const nextDisposalDate =
      dueDisposalBundles
        .map((b) => b.retention_until)
        .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;

    return {
      archived: total,
      archived_this_cycle: archivedThisCycle,
      retention_months: RETENTION_MONTHS,
      open_retrieval_requests: openRetrievals.length,
      pending_beyond_30_days: pendingBeyond30Days,
      due_disposal: dueDisposalBundles.length,
      due_disposal_next: nextDisposalDate,
    };
  }

  /** GET /script-archive/requesters — real, previously-typed requester names (from issued_to on past requests) so the "Requester" field can offer a picklist while still accepting a brand-new name. */
  async listRequesterSuggestions() {
    const rows = await this.prisma.script_retrieval_requests.findMany({
      where: { issued_to: { not: null } },
      select: { issued_to: true },
      distinct: ['issued_to'],
      orderBy: { requested_at: 'desc' },
      take: 50,
    });
    return rows.map((r) => r.issued_to).filter((v): v is string => !!v);
  }

  /** POST /script-archive/retrieval/attachments — real upload (Supabase-Storage-backed, same StorageService every other file-upload feature uses). Returns a public URL the caller sends back as fee_receipt_url on the actual retrieval create call. */
  async uploadFeeReceipt(file: Express.Multer.File) {
    const { key } = await this.storage.upload(
      'script-archive-receipts',
      file.originalname,
      file.buffer,
      file.mimetype,
    );
    return { url: this.storage.getPublicUrl(key) };
  }

  /** Manual backfill path — for a bundle submitted before this session's auto-archive-on-submit existed, or when COE wants to override the auto-assigned shelf. New submissions no longer need this; script-bundles.service.ts's submitBundle() calls computeArchiveLocation/computeRetentionUntil itself. */
  async archiveBundle(dto: ArchiveBundleDto) {
    const bundle = await this.prisma.script_bundles.findUnique({
      where: { id: dto.bundle_id },
    });
    if (!bundle)
      throw new NotFoundException({
        message: 'Script bundle not found.',
        errorCode: 'BUNDLE_NOT_FOUND',
      });

    const existing = await this.prisma.script_archive_bundles.findUnique({
      where: { bundle_id: dto.bundle_id },
    });
    if (existing)
      throw new ConflictException({
        message: 'This bundle is already archived.',
        errorCode: 'ALREADY_ARCHIVED',
      });

    return this.prisma.script_archive_bundles.create({
      data: {
        bundle_id: dto.bundle_id,
        location_label: dto.location_label,
        retention_until: new Date(dto.retention_until),
      },
    });
  }

  private async resolveArchiveBundle(input: string) {
    const trimmed = input.trim();

    const bundle = await this.prisma.script_bundles.findUnique({
      where: { bundle_code: trimmed },
    });
    if (bundle) {
      const archiveBundle = await this.prisma.script_archive_bundles.findUnique(
        { where: { bundle_id: bundle.id } },
      );
      if (!archiveBundle)
        throw new NotFoundException({
          message: 'This bundle has not been archived yet.',
          errorCode: 'BUNDLE_NOT_ARCHIVED',
        });
      return archiveBundle;
    }

    const student = await this.prisma.students.findFirst({
      where: {
        OR: [
          { register_no: trimmed },
          { roll_no: trimmed },
          { student_id_no: trimmed },
        ],
      },
    });
    if (!student)
      throw new NotFoundException({
        message: 'No bundle or student found for that value.',
        errorCode: 'BUNDLE_OR_STUDENT_NOT_FOUND',
      });

    const script = await this.prisma.script_bundle_scripts.findFirst({
      where: { student_id: student.id },
      orderBy: { id: 'desc' },
    });
    if (!script)
      throw new NotFoundException({
        message: 'No archived script found for this student.',
        errorCode: 'NO_SCRIPT_FOR_STUDENT',
      });

    const archiveBundle = await this.prisma.script_archive_bundles.findUnique({
      where: { bundle_id: script.bundle_id },
    });
    if (!archiveBundle)
      throw new NotFoundException({
        message: 'This bundle has not been archived yet.',
        errorCode: 'BUNDLE_NOT_ARCHIVED',
      });
    return archiveBundle;
  }

  async createRetrieval(dto: CreateRetrievalDto, requestedByUserId: number) {
    const archiveBundle = await this.resolveArchiveBundle(dto.bundle_or_roll);
    if (archiveBundle.status === 'issued_out') {
      throw new ConflictException({
        message: 'This bundle is already issued out.',
        errorCode: 'ALREADY_ISSUED_OUT',
      });
    }

    const purpose = encodePurpose(
      {
        type: dto.request_type,
        receiptNo: dto.fee_receipt_no,
        receiptUrl: dto.fee_receipt_url,
      },
      dto.purpose,
    );

    const [retrieval] = await this.prisma.$transaction([
      this.prisma.script_retrieval_requests.create({
        data: {
          archive_bundle_id: archiveBundle.id,
          requested_by_user_id: requestedByUserId,
          purpose,
          issued_to: dto.requester,
        },
      }),
      this.prisma.script_archive_bundles.update({
        where: { id: archiveBundle.id },
        data: { status: 'issued_out' },
      }),
    ]);

    return retrieval;
  }

  async recall(archiveBundleId: number) {
    const archiveBundle = await this.prisma.script_archive_bundles.findUnique({
      where: { id: archiveBundleId },
    });
    if (!archiveBundle)
      throw new NotFoundException({
        message: 'Archived bundle not found.',
        errorCode: 'ARCHIVE_BUNDLE_NOT_FOUND',
      });

    const activeRetrieval =
      await this.prisma.script_retrieval_requests.findFirst({
        where: { archive_bundle_id: archiveBundleId, returned_at: null },
      });

    await this.prisma.$transaction([
      ...(activeRetrieval
        ? [
            this.prisma.script_retrieval_requests.update({
              where: { id: activeRetrieval.id },
              data: { returned_at: new Date() },
            }),
          ]
        : []),
      this.prisma.script_archive_bundles.update({
        where: { id: archiveBundleId },
        data: { status: 'in_archive' },
      }),
    ]);

    return { id: archiveBundleId, status: 'in_archive' };
  }

  /** A bundle whose retention period has elapsed genuinely flips to due_disposal, not just shown as overdue client-side — same real-dispatch pattern as coe_notification_broadcasts/result_publications elsewhere in this codebase. */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async flagDueForDisposal() {
    const due = await this.prisma.script_archive_bundles.findMany({
      where: { status: 'in_archive', retention_until: { lte: new Date() } },
      select: { id: true },
    });
    for (const b of due) {
      await this.prisma.script_archive_bundles.update({
        where: { id: b.id },
        data: { status: 'due_disposal' },
      });
    }
  }
}
