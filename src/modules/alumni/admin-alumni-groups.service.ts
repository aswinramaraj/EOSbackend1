import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateAlumniMessageDto } from './dto/create-alumni-message.dto';

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

/**
 * Principal/Admin browsing ANY alumni batch's group directly — distinct
 * from MeAlumniGroupService/MeAlumniMessagesService, which are hard-locked
 * to the caller's own batch (resolved via their own alumni_members row).
 * Here the alumni_batch_id is a client-supplied path param, since a
 * Principal/Admin isn't a member of any batch and needs to pick one from
 * the list (see AdminAlumniBatchesService.listBatches).
 */
@Injectable()
export class AdminAlumniGroupsService {
  constructor(private readonly prisma: PrismaService) {}

  /** GET /admin/alumni-batches/:alumniBatchId — group header info. */
  async getGroupDetail(alumniBatchId: number) {
    const group = await this.prisma.alumni_batches.findUnique({
      where: { id: alumniBatchId },
      include: {
        batches: { select: { id: true, name: true } },
        _count: { select: { alumni_members: true } },
      },
    });
    if (!group) {
      throw new NotFoundException({
        message: 'Alumni batch not found',
        errorCode: 'ALUMNI_BATCH_NOT_FOUND',
      });
    }

    return {
      id: group.id,
      batch_id: group.batch_id,
      batch_name: group.batches.name,
      // "Batch number" for display - see AdminAlumniBatchesService.listBatches.
      batch_label: group.batches.name.replace(/_/g, '-'),
      group_name: group.group_name,
      graduated_on: group.graduated_on,
      member_count: group._count.alumni_members,
    };
  }

  /**
   * GET /admin/alumni-batches/:alumniBatchId/timeline — every real chat
   * message plus every real member-joined event, merged into one
   * chronological feed. A "joined" entry is never a stored row — it's
   * synthesized from alumni_members.joined_at, grouped by calendar day
   * (a whole batch typically graduates on the same day via the graduation
   * cron, so "X and N others joined" reflects a real shared join date, not
   * an invented grouping). No pagination — one batch's total members +
   * messages is small and bounded, unlike a general-purpose chat log.
   */
  async listTimeline(alumniBatchId: number) {
    await this.assertBatchExists(alumniBatchId);

    const [messages, members] = await Promise.all([
      this.prisma.alumni_group_messages.findMany({
        where: { alumni_batch_id: alumniBatchId },
        orderBy: { created_at: 'asc' },
        include: {
          alumni_members: {
            include: {
              students: {
                select: {
                  users: { select: { email: true } },
                  soa_applications: { select: { first_name: true, last_name: true } },
                },
              },
            },
          },
          users: { select: { roles: { select: { name: true } } } },
        },
      }),
      this.prisma.alumni_members.findMany({
        where: { alumni_batch_id: alumniBatchId },
        orderBy: { joined_at: 'asc' },
        include: {
          students: {
            select: {
              users: { select: { email: true } },
              soa_applications: { select: { first_name: true, last_name: true } },
            },
          },
        },
      }),
    ]);

    const messageEvents = messages.map((message) => ({
      kind: 'message' as const,
      id: message.id,
      content: message.content,
      attachment_url: message.attachment_url,
      posted_by_name: message.alumni_members
        ? resolveStudentName(message.alumni_members.students)
        : this.resolveStaffLabel(message.users),
      at: message.created_at,
    }));

    const joinsByDay = new Map<string, typeof members>();
    for (const member of members) {
      const dayKey = member.joined_at.toISOString().slice(0, 10);
      const group = joinsByDay.get(dayKey) ?? [];
      group.push(member);
      joinsByDay.set(dayKey, group);
    }

    const joinEvents = Array.from(joinsByDay.values()).map((group) => {
      const names = group.map((member) => resolveStudentName(member.students));
      const text =
        names.length > 1
          ? `${names[0]} and ${names.length - 1} other${names.length > 2 ? 's' : ''} joined`
          : `${names[0]} joined`;
      return {
        kind: 'join' as const,
        id: `join-${group[0].id}`,
        text,
        at: group[0].joined_at,
      };
    });

    return [...messageEvents, ...joinEvents].sort(
      (a, b) => a.at.getTime() - b.at.getTime(),
    );
  }

  /**
   * POST /admin/alumni-batches/:alumniBatchId/messages — posts as the
   * caller (a non-alumnus, via posted_by_user_id), never as an
   * alumni_members row the caller doesn't have. Mutually exclusive with
   * MeAlumniMessagesService.createMessage's posted_by_alumni_member_id path.
   */
  async createMessageForBatch(
    userId: number,
    alumniBatchId: number,
    dto: CreateAlumniMessageDto,
  ) {
    await this.assertBatchExists(alumniBatchId);

    return this.prisma.alumni_group_messages.create({
      data: {
        alumni_batch_id: alumniBatchId,
        posted_by_user_id: userId,
        content: dto.content,
        attachment_url: dto.attachment_url,
      },
    });
  }

  private resolveStaffLabel(user: { roles: { name: string } } | null): string {
    if (!user) return 'Unknown';
    const { name } = user.roles;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }

  private async assertBatchExists(alumniBatchId: number) {
    const batch = await this.prisma.alumni_batches.findUnique({
      where: { id: alumniBatchId },
    });
    if (!batch) {
      throw new NotFoundException({
        message: 'Alumni batch not found',
        errorCode: 'ALUMNI_BATCH_NOT_FOUND',
      });
    }
  }
}
