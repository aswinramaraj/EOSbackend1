import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { notification_type_enum } from '../../../generated/prisma/enums';
import {
  MESSAGING_PUSHER,
  type MessagingPusher,
} from './messaging-pusher.interface';
import { PresenceService } from './presence.service';
import type { SendMessageDto } from './dto/send-message.dto';
import type { EditMessageDto } from './dto/edit-message.dto';
import type { ListConversationsQueryDto } from './dto/list-conversations-query.dto';
import type { ListMessagesQueryDto } from './dto/list-messages-query.dto';
import type { SearchPeopleQueryDto } from './dto/search-people-query.dto';

/** A student's search/send target is blocked at both layers — this code name is what the client matches on. */
export const STUDENT_TO_STUDENT_BLOCKED = 'STUDENT_TO_STUDENT_BLOCKED';

function personDisplayName(row: {
  faculty?: { first_name: string; last_name: string } | null;
  students?: {
    soa_applications?: { first_name: string; last_name: string | null } | null;
  } | null;
  email: string;
}): string {
  if (row.faculty)
    return `${row.faculty.first_name} ${row.faculty.last_name}`.trim();
  const app = row.students?.soa_applications;
  if (app) return `${app.first_name} ${app.last_name ?? ''}`.trim();
  return row.email;
}

function personRoleLabel(row: {
  roles: { name: string };
  faculty?: {
    designation: string;
    departments: { name: string; code: string };
  } | null;
  students?: {
    classes: { section: string; departments: { code: string } } | null;
  } | null;
}): string {
  if (row.faculty)
    return [row.faculty.designation, row.faculty.departments.code]
      .filter(Boolean)
      .join(' · ');
  if (row.students) {
    const cls = row.students.classes;
    return [
      'Student',
      cls ? `${cls.departments.code} · Sec ${cls.section}` : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  return row.roles.name;
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly presence: PresenceService,
    @Inject(forwardRef(() => MESSAGING_PUSHER))
    private readonly gateway: MessagingPusher,
  ) {}

  // ───────────────────────────── access control ─────────────────────────────

  /** The actual rule, with no DB access — split out so a caller that already has the other party's role in hand (e.g. sendMessage's combined fetch) can check it without a redundant query. */
  private assertRoleAllowsMessaging(
    senderRole: string,
    otherRoleName: string,
  ): void {
    if (senderRole !== ROLES.STUDENT) return;
    if (otherRoleName === ROLES.STUDENT) {
      throw new ForbiddenException({
        message: 'Students cannot message other students',
        errorCode: STUDENT_TO_STUDENT_BLOCKED,
      });
    }
  }

  /**
   * Enforced on both the conversation-creation path and every single
   * message:send — never cached from creation time, so a role change after
   * a conversation already exists is still caught on the next send.
   */
  async assertCanMessage(
    senderRole: string,
    otherUserId: number,
  ): Promise<void> {
    if (senderRole !== ROLES.STUDENT) return;
    const other = await this.prisma.users.findUnique({
      where: { id: otherUserId },
      select: { roles: { select: { name: true } } },
    });
    if (!other) throw new NotFoundException('User not found');
    this.assertRoleAllowsMessaging(senderRole, other.roles.name);
  }

  async searchPeople(
    callerUserId: number,
    callerRole: string,
    query: SearchPeopleQueryDto,
  ) {
    const q = query.q?.trim();
    if (!q || q.length < 1) return [];

    const rows = await this.prisma.users.findMany({
      where: {
        id: { not: callerUserId },
        status: 'active',
        // The hard rule lives directly in this WHERE — a student never even
        // appears in another student's result set, not filtered after the
        // query runs.
        ...(callerRole === ROLES.STUDENT && {
          roles: { name: { not: ROLES.STUDENT } },
        }),
        OR: [
          {
            faculty: {
              OR: [
                { first_name: { contains: q, mode: 'insensitive' } },
                { last_name: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
          {
            students: {
              soa_applications: {
                OR: [
                  { first_name: { contains: q, mode: 'insensitive' } },
                  { last_name: { contains: q, mode: 'insensitive' } },
                ],
              },
            },
          },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 20,
      select: {
        id: true,
        email: true,
        roles: { select: { name: true } },
        faculty: {
          select: {
            first_name: true,
            last_name: true,
            designation: true,
            departments: { select: { name: true, code: true } },
          },
        },
        students: {
          select: {
            classes: {
              select: {
                section: true,
                departments: { select: { code: true } },
              },
            },
            soa_applications: { select: { first_name: true, last_name: true } },
          },
        },
      },
    });

    return rows.map((row) => ({
      userId: row.id,
      name: personDisplayName(row),
      roleLabel: personRoleLabel(row),
    }));
  }

  /** For a student: the class's current advisor + their personal mentor, if set — surfaced as suggested contacts. */
  async getSuggestedContacts(callerUserId: number, callerRole: string) {
    if (callerRole !== ROLES.STUDENT) return [];

    const student = await this.prisma.students.findUnique({
      where: { user_id: callerUserId },
      select: { class_id: true, mentor_faculty_id: true },
    });
    if (!student) return [];

    const [classMentor, personalMentor] = await Promise.all([
      student.class_id
        ? this.prisma.class_mentors.findFirst({
            where: { class_id: student.class_id },
            orderBy: { academic_year: 'desc' },
            select: {
              faculty: {
                select: {
                  user_id: true,
                  first_name: true,
                  last_name: true,
                  designation: true,
                  departments: { select: { code: true } },
                },
              },
            },
          })
        : null,
      student.mentor_faculty_id
        ? this.prisma.faculty.findUnique({
            where: { id: student.mentor_faculty_id },
            select: {
              user_id: true,
              first_name: true,
              last_name: true,
              designation: true,
              departments: { select: { code: true } },
            },
          })
        : null,
    ]);

    const toContact = (
      f: {
        user_id: number;
        first_name: string;
        last_name: string;
        designation: string;
        departments: { code: string };
      },
      label: string,
    ) => ({
      userId: f.user_id,
      name: `${f.first_name} ${f.last_name}`.trim(),
      roleLabel: `${f.designation} · ${f.departments.code}`,
      suggestionLabel: label,
    });

    const contacts: ReturnType<typeof toContact>[] = [];
    if (classMentor?.faculty)
      contacts.push(toContact(classMentor.faculty, 'Class advisor'));
    if (
      personalMentor &&
      personalMentor.user_id !== classMentor?.faculty?.user_id
    ) {
      contacts.push(toContact(personalMentor, 'Your mentor'));
    }
    return contacts;
  }

  // ───────────────────────────── conversations ─────────────────────────────

  async getOrCreateConversation(
    callerUserId: number,
    callerRole: string,
    otherUserId: number,
  ) {
    if (otherUserId === callerUserId)
      throw new BadRequestException(
        'Cannot start a conversation with yourself',
      );
    await this.assertCanMessage(callerRole, otherUserId);

    const dmKey = [callerUserId, otherUserId].sort((a, b) => a - b).join(':');

    const existing = await this.prisma.message_conversations.findUnique({
      where: { dm_key: dmKey },
    });
    if (existing) return this.toConversationSummary(existing.id, callerUserId);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        const conversation = await tx.message_conversations.create({
          data: { dm_key: dmKey, created_by_user_id: callerUserId },
        });
        await tx.message_participants.createMany({
          data: [
            { conversation_id: conversation.id, user_id: callerUserId },
            { conversation_id: conversation.id, user_id: otherUserId },
          ],
        });
        return conversation;
      });
      // Deliberately no push to the other participant here, and this row is
      // excluded from listConversations() until a message actually exists —
      // starting a chat must stay invisible to the other side until the
      // first message is sent (see sendMessage's first-message branch).
      return this.toConversationSummary(created.id, callerUserId);
    } catch {
      // Race: the other participant's own get-or-create call won between our
      // check above and our insert — the partial unique index on dm_key
      // rejected our insert, so the real row now exists; fetch and return it.
      const row = await this.prisma.message_conversations.findUniqueOrThrow({
        where: { dm_key: dmKey },
      });
      return this.toConversationSummary(row.id, callerUserId);
    }
  }

  /**
   * Batched, not N+1: one query for the caller's page of conversations, one
   * for the other participant of each, one for those participants' display
   * details, one for the last-message bodies, and one raw aggregate for all
   * their unread counts at once — a fixed 5 queries regardless of list size,
   * versus the previous per-conversation toConversationSummary() loop (up to
   * 3×N round trips for N conversations).
   */
  async listConversations(
    callerUserId: number,
    query: ListConversationsQueryDto,
  ) {
    const limit = query.limit ?? 30;
    const beforeCursor = query.beforeId
      ? await this.prisma.message_conversations.findUnique({
          where: { id: query.beforeId },
          select: { last_message_at: true },
        })
      : null;

    const myParticipation = await this.prisma.message_participants.findMany({
      where: {
        user_id: callerUserId,
        message_conversations: {
          // A conversation that was only ever created (e.g. clicked into
          // from search) but never actually sent a message stays invisible
          // — to both participants — until the first message lands.
          last_message_id: { not: null },
          ...(beforeCursor && {
            last_message_at: { lt: beforeCursor.last_message_at ?? undefined },
          }),
        },
      },
      select: {
        conversation_id: true,
        message_conversations: {
          select: { last_message_id: true, last_message_at: true },
        },
      },
      orderBy: { message_conversations: { last_message_at: 'desc' } },
      take: limit,
    });
    if (myParticipation.length === 0) return [];

    const conversationIds = myParticipation.map((p) => p.conversation_id);

    const [otherParticipants, unreadRows] = await Promise.all([
      this.prisma.message_participants.findMany({
        where: {
          conversation_id: { in: conversationIds },
          user_id: { not: callerUserId },
        },
        select: {
          conversation_id: true,
          users: {
            select: {
              id: true,
              email: true,
              roles: { select: { name: true } },
              faculty: {
                select: {
                  first_name: true,
                  last_name: true,
                  designation: true,
                  departments: { select: { name: true, code: true } },
                },
              },
              students: {
                select: {
                  classes: {
                    select: {
                      section: true,
                      departments: { select: { code: true } },
                    },
                  },
                  soa_applications: {
                    select: { first_name: true, last_name: true },
                  },
                },
              },
            },
          },
        },
      }),
      this.prisma.$queryRaw<{ conversation_id: bigint; count: bigint }[]>`
        SELECT m.conversation_id, COUNT(*) as count
        FROM messages m
        JOIN message_participants mp
          ON mp.conversation_id = m.conversation_id AND mp.user_id = ${callerUserId}
        WHERE m.conversation_id = ANY(${conversationIds}::bigint[])
          AND m.sender_user_id != ${callerUserId}
          AND (mp.last_read_message_id IS NULL OR m.id > mp.last_read_message_id)
        GROUP BY m.conversation_id
      `,
    ]);

    const lastMessageIds = myParticipation
      .map((p) => p.message_conversations.last_message_id)
      .filter((id): id is bigint => id !== null);
    const lastMessages =
      lastMessageIds.length > 0
        ? await this.prisma.messages.findMany({
            where: { id: { in: lastMessageIds } },
            select: {
              id: true,
              body: true,
              sender_user_id: true,
              created_at: true,
              is_deleted_for_everyone: true,
            },
          })
        : [];

    const otherByConversation = new Map(
      otherParticipants.map((p) => [p.conversation_id.toString(), p.users]),
    );
    const lastMessageById = new Map(
      lastMessages.map((m) => [m.id.toString(), m]),
    );
    const unreadByConversation = new Map(
      unreadRows.map((r) => [r.conversation_id.toString(), Number(r.count)]),
    );

    const summaries = myParticipation
      .map((p) => {
        const otherUser = otherByConversation.get(p.conversation_id.toString());
        if (!otherUser) return null;
        const lastMessageId = p.message_conversations.last_message_id;
        const lastMessage = lastMessageId
          ? lastMessageById.get(lastMessageId.toString())
          : null;

        return {
          id: Number(p.conversation_id),
          otherUser: {
            userId: otherUser.id,
            name: personDisplayName(otherUser),
            roleLabel: personRoleLabel(otherUser),
          },
          lastMessage: lastMessage
            ? {
                id: Number(lastMessage.id),
                body: lastMessage.is_deleted_for_everyone
                  ? null
                  : lastMessage.body,
                isDeleted: lastMessage.is_deleted_for_everyone,
                senderUserId: lastMessage.sender_user_id,
                createdAt: lastMessage.created_at.toISOString(),
              }
            : null,
          lastMessageAt:
            p.message_conversations.last_message_at?.toISOString() ?? null,
          unreadCount:
            unreadByConversation.get(p.conversation_id.toString()) ?? 0,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    return summaries;
  }

  async getUnreadCount(callerUserId: number): Promise<number> {
    const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*) as count
      FROM messages m
      JOIN message_participants mp
        ON mp.conversation_id = m.conversation_id AND mp.user_id = ${callerUserId}
      WHERE m.sender_user_id != ${callerUserId}
        AND (mp.last_read_message_id IS NULL OR m.id > mp.last_read_message_id)
    `;
    return Number(rows[0]?.count ?? 0);
  }

  private async toConversationSummary(
    conversationId: bigint | number,
    callerUserId: number,
  ) {
    const conversation = await this.prisma.message_conversations.findUnique({
      where: { id: conversationId },
      include: {
        message_participants: {
          include: {
            users: {
              select: {
                id: true,
                email: true,
                roles: { select: { name: true } },
                faculty: {
                  select: {
                    first_name: true,
                    last_name: true,
                    designation: true,
                    departments: { select: { name: true, code: true } },
                  },
                },
                students: {
                  select: {
                    classes: {
                      select: {
                        section: true,
                        departments: { select: { code: true } },
                      },
                    },
                    soa_applications: {
                      select: { first_name: true, last_name: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!conversation) return null;

    const me = conversation.message_participants.find(
      (p) => p.user_id === callerUserId,
    );
    const otherParticipant = conversation.message_participants.find(
      (p) => p.user_id !== callerUserId,
    );
    if (!otherParticipant) return null;

    const lastMessage = conversation.last_message_id
      ? await this.prisma.messages.findUnique({
          where: { id: conversation.last_message_id },
          select: {
            id: true,
            body: true,
            sender_user_id: true,
            created_at: true,
            is_deleted_for_everyone: true,
          },
        })
      : null;

    const unread = await this.prisma.messages.count({
      where: {
        conversation_id: conversation.id,
        sender_user_id: { not: callerUserId },
        ...(me?.last_read_message_id
          ? { id: { gt: me.last_read_message_id } }
          : {}),
      },
    });

    return {
      id: Number(conversation.id),
      otherUser: {
        userId: otherParticipant.users.id,
        name: personDisplayName(otherParticipant.users),
        roleLabel: personRoleLabel(otherParticipant.users),
      },
      lastMessage: lastMessage
        ? {
            id: Number(lastMessage.id),
            body: lastMessage.is_deleted_for_everyone ? null : lastMessage.body,
            isDeleted: lastMessage.is_deleted_for_everyone,
            senderUserId: lastMessage.sender_user_id,
            createdAt: lastMessage.created_at.toISOString(),
          }
        : null,
      lastMessageAt: conversation.last_message_at?.toISOString() ?? null,
      unreadCount: unread,
    };
  }

  // ───────────────────────────── messages ─────────────────────────────

  /** Public: also called directly by MessagingGateway (conversation:join) to verify a socket may subscribe to a conversation's room before joining it. */
  async assertParticipant(conversationId: number, userId: number) {
    const participant = await this.prisma.message_participants.findUnique({
      where: {
        conversation_id_user_id: {
          conversation_id: conversationId,
          user_id: userId,
        },
      },
    });
    if (!participant)
      throw new ForbiddenException('You are not part of this conversation');
    return participant;
  }

  async listMessages(
    callerUserId: number,
    conversationId: number,
    query: ListMessagesQueryDto,
  ) {
    await this.assertParticipant(conversationId, callerUserId);
    const limit = query.limit ?? 50;

    const rows = await this.prisma.messages.findMany({
      where: {
        conversation_id: conversationId,
        ...(query.beforeId && { id: { lt: query.beforeId } }),
      },
      orderBy: { id: 'desc' },
      take: limit,
    });

    return rows
      .map((m) => ({
        id: Number(m.id),
        conversationId: Number(m.conversation_id),
        senderUserId: m.sender_user_id,
        body: m.is_deleted_for_everyone ? null : m.body,
        isDeleted: m.is_deleted_for_everyone,
        isEdited: m.is_edited,
        status: m.status,
        createdAt: m.created_at.toISOString(),
        deliveredAt: m.delivered_at?.toISOString() ?? null,
        readAt: m.read_at?.toISOString() ?? null,
      }))
      .reverse();
  }

  async sendMessage(
    senderUserId: number,
    senderRole: string,
    dto: SendMessageDto,
  ) {
    // One combined fetch instead of three separate round trips (participant
    // check + conversation load + a fresh role lookup for assertCanMessage)
    // — this is the hot path for "send", so every query here is on the
    // critical path the sender is waiting on.
    const conversation = await this.prisma.message_conversations.findUnique({
      where: { id: dto.conversationId },
      include: {
        message_participants: {
          include: { users: { select: { roles: { select: { name: true } } } } },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    const me = conversation.message_participants.find(
      (p) => p.user_id === senderUserId,
    );
    if (!me)
      throw new ForbiddenException('You are not part of this conversation');
    const recipient = conversation.message_participants.find(
      (p) => p.user_id !== senderUserId,
    );
    if (!recipient)
      throw new NotFoundException('Conversation has no recipient');

    // Re-checked on every send, not cached from conversation-creation time —
    // closes the race where a role changes after the conversation exists.
    // The recipient's CURRENT role came back with the query above, so this
    // is a pure in-memory check now, not another DB call.
    this.assertRoleAllowsMessaging(senderRole, recipient.users.roles.name);

    const isFirstMessage = conversation.last_message_id === null;
    const recipientOnline = this.presence.isOnline(recipient.user_id);

    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.messages.create({
        data: {
          conversation_id: dto.conversationId,
          sender_user_id: senderUserId,
          body: dto.body,
          client_generated_id: dto.clientGeneratedId,
          status: recipientOnline ? 'delivered' : 'sent',
          delivered_at: recipientOnline ? new Date() : null,
        },
      });
      await tx.message_conversations.update({
        where: { id: dto.conversationId },
        data: {
          last_message_id: created.id,
          last_message_at: created.created_at,
          updated_at: new Date(),
        },
      });
      return created;
    });

    const payload = {
      id: Number(message.id),
      conversationId: Number(message.conversation_id),
      senderUserId: message.sender_user_id,
      body: message.body,
      status: message.status,
      createdAt: message.created_at.toISOString(),
      deliveredAt: message.delivered_at?.toISOString() ?? null,
      clientGeneratedId: message.client_generated_id,
    };

    // Everything below is a side effect for the OTHER participant (making a
    // brand-new conversation visible to them, or notifying them offline) —
    // none of it changes what the sender's own ack contains, so it runs
    // after the response is already on its way back rather than adding its
    // latency to the send the user is sitting there waiting on.
    void this.runPostSendSideEffects(
      dto,
      senderUserId,
      recipient.user_id,
      isFirstMessage,
      recipientOnline,
    ).catch((err: unknown) =>
      this.logger.error('Post-send side effects failed', err),
    );

    return { message: payload, clientGeneratedId: dto.clientGeneratedId };
  }

  private async runPostSendSideEffects(
    dto: SendMessageDto,
    senderUserId: number,
    recipientUserId: number,
    isFirstMessage: boolean,
    recipientOnline: boolean,
  ): Promise<void> {
    await Promise.all([
      // The conversation only becomes visible to the recipient once a real
      // message exists in it (see getOrCreateConversation / listConversations)
      // — this is the moment that first happens, so push the full summary
      // (their `user:<id>` room, not the conversation room they haven't
      // joined yet) and join their sockets to the room for future live pushes.
      isFirstMessage
        ? this.toConversationSummary(dto.conversationId, recipientUserId).then(
            (summaryForRecipient) => {
              this.gateway.joinUserToConversation(
                recipientUserId,
                Number(dto.conversationId),
              );
              this.gateway.pushToUser(recipientUserId, 'conversation:new', {
                conversation: summaryForRecipient,
              });
            },
          )
        : Promise.resolve(),
      recipientOnline
        ? Promise.resolve()
        : this.prisma.users
            .findUnique({
              where: { id: senderUserId },
              select: {
                email: true,
                faculty: { select: { first_name: true, last_name: true } },
                students: {
                  select: {
                    soa_applications: {
                      select: { first_name: true, last_name: true },
                    },
                  },
                },
              },
            })
            .then((senderInfo) =>
              this.notifications.notify({
                user_id: recipientUserId,
                title: senderInfo
                  ? personDisplayName(senderInfo)
                  : 'New message',
                message: dto.body.slice(0, 120),
                type: notification_type_enum.direct_message_received,
                related_entity_type: 'message_conversation',
                related_entity_id: Number(dto.conversationId),
              }),
            ),
    ]);
  }

  async markRead(
    callerUserId: number,
    conversationId: number,
    upToMessageId: number,
  ) {
    await this.assertParticipant(conversationId, callerUserId);
    await this.prisma.message_participants.update({
      where: {
        conversation_id_user_id: {
          conversation_id: conversationId,
          user_id: callerUserId,
        },
      },
      data: { last_read_message_id: upToMessageId, last_read_at: new Date() },
    });
    await this.prisma.messages.updateMany({
      where: {
        conversation_id: conversationId,
        id: { lte: upToMessageId },
        sender_user_id: { not: callerUserId },
        status: { not: 'read' },
      },
      data: { status: 'read', read_at: new Date() },
    });
    return { conversationId, upToMessageId };
  }

  async editMessage(
    callerUserId: number,
    messageId: number,
    dto: EditMessageDto,
  ) {
    const message = await this.prisma.messages.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.sender_user_id !== callerUserId)
      throw new ForbiddenException('You can only edit your own messages');
    if (message.is_deleted_for_everyone)
      throw new BadRequestException('Cannot edit a deleted message');

    const updated = await this.prisma.messages.update({
      where: { id: messageId },
      data: { body: dto.body, is_edited: true, edited_at: new Date() },
    });
    const result = {
      id: Number(updated.id),
      conversationId: Number(updated.conversation_id),
      body: updated.body,
      editedAt: updated.edited_at?.toISOString() ?? null,
    };
    this.gateway.pushToConversation(result.conversationId, 'message:edited', {
      conversationId: result.conversationId,
      messageId: result.id,
      body: result.body,
      editedAt: result.editedAt,
    });
    return result;
  }

  async deleteMessage(callerUserId: number, messageId: number) {
    const message = await this.prisma.messages.findUnique({
      where: { id: messageId },
    });
    if (!message) throw new NotFoundException('Message not found');
    if (message.sender_user_id !== callerUserId)
      throw new ForbiddenException('You can only delete your own messages');

    const updated = await this.prisma.messages.update({
      where: { id: messageId },
      data: {
        is_deleted_for_everyone: true,
        deleted_at: new Date(),
        deleted_by_user_id: callerUserId,
      },
    });
    const result = {
      id: Number(updated.id),
      conversationId: Number(updated.conversation_id),
      deletedAt: updated.deleted_at?.toISOString() ?? null,
    };
    this.gateway.pushToConversation(result.conversationId, 'message:deleted', {
      conversationId: result.conversationId,
      messageId: result.id,
      deletedAt: result.deletedAt,
    });
    return result;
  }
}
