import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate, PaginationDto } from 'src/common/dto/pagination.dto';

interface StudentNameSource {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}

/** See MeAlumniGroupService — same students-name-resolution fallback. */
function resolveStudentName(student: StudentNameSource): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

const STUDENT_NAME_SELECT = {
  users: { select: { email: true } },
  soa_applications: { select: { first_name: true, last_name: true } },
} as const;

@Injectable()
export class AdminAlumniBatchesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /admin/alumni-batches
   *
   * member_count is resolved via Prisma's relation `_count` aggregate, and
   * the most-recently-joined member (for `latest_activity`'s preview line)
   * via a nested `take: 1` include - both folded into the same single
   * findMany + count call this was already tested to make (no per-row N+1).
   * Only reflects joins, not chat messages - showing the true "most recent
   * of either" would need a separate per-row query, which would break that
   * same single-query guarantee; the full per-group timeline (which does
   * merge both) is available via GET .../:alumniBatchId/timeline.
   */
  async listBatches(dto: PaginationDto) {
    const [rows, total] = await Promise.all([
      this.prisma.alumni_batches.findMany({
        skip: dto.skip,
        take: dto.limit,
        orderBy: { graduated_on: 'desc' },
        include: {
          batches: { select: { id: true, name: true } },
          _count: { select: { alumni_members: true } },
          alumni_members: {
            orderBy: { joined_at: 'desc' },
            take: 1,
            select: { joined_at: true, students: { select: STUDENT_NAME_SELECT } },
          },
        },
      }),
      this.prisma.alumni_batches.count(),
    ]);

    const data = rows.map(({ _count, alumni_members, ...batch }) => {
      const latestMember = alumni_members?.[0];
      return {
        ...batch,
        // "Batch number" for display - the batch's own year-range (e.g.
        // "2022-2026"), not the descriptive group_name (which can span
        // multiple departments, e.g. "CSE / AIDS / ECE - Batch of 2026").
        batch_label: batch.batches.name.replace(/_/g, '-'),
        member_count: _count.alumni_members,
        latest_activity: latestMember
          ? {
              type: 'join' as const,
              text: `${resolveStudentName(latestMember.students)} joined`,
              at: latestMember.joined_at,
            }
          : null,
      };
    });

    return paginate(data, total, dto);
  }
}
