import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { paginate, PaginationDto } from 'src/common/dto/pagination.dto';
import { CreateAlumniMessageDto } from './dto/create-alumni-message.dto';

/** See MeAlumniGroupService — same students-name-resolution fallback. */
function resolveStudentName(student: {
  soa_applications: { first_name: string; last_name: string | null } | null;
  users: { email: string };
}): string {
  if (student.soa_applications) {
    const { first_name, last_name } = student.soa_applications;
    return last_name ? `${first_name} ${last_name}` : first_name;
  }
  return student.users.email;
}

/**
 * Alumni group chat, scoped to the caller's own batch.
 *
 * Critical isolation rule: a member of batch A must never read or post into
 * batch B's messages, even by guessing IDs. There is no client-supplied
 * batch id anywhere in these routes — `alumni_batch_id` is always resolved
 * server-side from the caller's own alumni_members row, both for the list
 * filter and for the row being inserted. Delete additionally checks message
 * ownership, which — via the posted_by_alumni_member_id FK — can only ever
 * point back to a message in the owner's own batch.
 */
@Injectable()
export class MeAlumniMessagesService {
  constructor(private readonly prisma: PrismaService) {}

  async listMessages(userId: number, dto: PaginationDto) {
    const member = await this.getOwnMemberOrThrow(userId);

    const where = { alumni_batch_id: member.alumni_batch_id };
    const [rows, total] = await Promise.all([
      this.prisma.alumni_group_messages.findMany({
        where,
        skip: dto.skip,
        take: dto.limit,
        orderBy: { created_at: 'desc' },
        include: {
          alumni_members: {
            include: {
              students: {
                select: {
                  id: true,
                  users: { select: { email: true } },
                  soa_applications: {
                    select: { first_name: true, last_name: true },
                  },
                },
              },
            },
          },
          users: { select: { email: true } },
        },
      }),
      this.prisma.alumni_group_messages.count({ where }),
    ]);

    // alumni_members is null for messages posted directly via posted_by_user_id
    // (see the model comment on alumni_group_messages) rather than through the
    // poster's own alumni_members row — fall back to that user's email, same
    // convention resolveStudentName already uses when soa_applications is missing.
    const data = rows.map(({ alumni_members, users, ...message }) => ({
      ...message,
      posted_by_name: alumni_members
        ? resolveStudentName(alumni_members.students)
        : (users?.email ?? 'Unknown'),
    }));

    return paginate(data, total, dto);
  }

  async createMessage(userId: number, dto: CreateAlumniMessageDto) {
    const member = await this.getOwnMemberOrThrow(userId);

    return this.prisma.alumni_group_messages.create({
      data: {
        alumni_batch_id: member.alumni_batch_id,
        posted_by_alumni_member_id: member.id,
        content: dto.content,
        attachment_url: dto.attachment_url,
      },
    });
  }

  async deleteMessage(userId: number, messageId: number) {
    const member = await this.getOwnMemberOrThrow(userId);

    const message = await this.prisma.alumni_group_messages.findUnique({
      where: { id: messageId },
    });
    if (!message) {
      throw new NotFoundException({
        message: `Message ${messageId} not found`,
        errorCode: 'MESSAGE_NOT_FOUND',
      });
    }

    // posted_by_alumni_member_id can only ever belong to the poster's own
    // batch, so this ownership check is also a batch-isolation check.
    if (message.posted_by_alumni_member_id !== member.id) {
      throw new ForbiddenException({
        message: 'You can only delete your own messages',
        errorCode: 'NOT_MESSAGE_OWNER',
      });
    }

    await this.prisma.alumni_group_messages.delete({
      where: { id: messageId },
    });
    return { id: messageId };
  }

  private async getOwnMemberOrThrow(userId: number) {
    const student = await this.prisma.students.findUnique({
      where: { user_id: userId },
    });
    if (!student) {
      throw new NotFoundException({
        message: 'Student profile not found for the current user',
        errorCode: 'STUDENT_NOT_FOUND',
      });
    }

    const member = await this.prisma.alumni_members.findUnique({
      where: { student_id: student.id },
    });
    if (!member) {
      throw new ForbiddenException({
        message: 'You are not registered as an alumnus',
        errorCode: 'NOT_AN_ALUMNUS',
      });
    }

    return member;
  }
}
