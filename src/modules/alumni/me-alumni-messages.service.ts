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
 * A message's poster is either the alumni_members row (student side, the
 * normal path via createMessage below) or a plain `users` row (staff/admin
 * posting directly — no alumni_members link). Same faculty-then-
 * non_teaching_staff-then-email fallback as VenuesService.resolveBookerName.
 */
function resolvePosterName(message: {
  alumni_members: {
    students: {
      soa_applications: { first_name: string; last_name: string | null } | null;
      users: { email: string };
    };
  } | null;
  users: {
    email: string;
    faculty: { first_name: string; last_name: string } | null;
    non_teaching_staff: { first_name: string; last_name: string | null }[];
  } | null;
}): string {
  if (message.alumni_members) {
    return resolveStudentName(message.alumni_members.students);
  }
  const user = message.users;
  if (!user) {
    return 'Unknown';
  }
  if (user.faculty) {
    return `${user.faculty.first_name} ${user.faculty.last_name}`;
  }
  if (user.non_teaching_staff[0]) {
    const staff = user.non_teaching_staff[0];
    return staff.last_name
      ? `${staff.first_name} ${staff.last_name}`
      : staff.first_name;
  }
  return user.email;
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
          users: {
            select: {
              email: true,
              faculty: { select: { first_name: true, last_name: true } },
              non_teaching_staff: {
                select: { first_name: true, last_name: true },
              },
            },
          },
        },
      }),
      this.prisma.alumni_group_messages.count({ where }),
    ]);

    const data = rows.map(({ alumni_members, users, ...message }) => ({
      ...message,
      posted_by_name: resolvePosterName({ alumni_members, users }),
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
