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
import {
  MessagingService,
  PERSON_SELECT,
  dmPairKey,
  toMessagePerson,
} from './messaging.service';

/**
 * Student-to-student chat requests + student-created-group invitations — the
 * consent step required before a student ever gets a real
 * message_participants row for either kind of conversation (see
 * schema.prisma's message_requests model doc comment). Deliberately its own
 * service/controller rather than folded into MessagingService: it owns the
 * message_requests lifecycle end to end, while MessagingService keeps owning
 * message_conversations/message_participants directly (dm_key materialize,
 * group creation/membership) — this service calls back into that one for the
 * handful of things that genuinely belong there (materializeDmConversation,
 * getConversationSummaryForUser, getGroupDetails), same one-directional
 * dependency shape the module already uses elsewhere (no circular DI risk).
 */
@Injectable()
export class MessageRequestsService {
  private readonly logger = new Logger(MessageRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly notifications: NotificationsService,
    @Inject(forwardRef(() => MESSAGING_PUSHER))
    private readonly gateway: MessagingPusher,
  ) {}

  private async assertActiveStudent(userId: number): Promise<void> {
    const row = await this.prisma.users.findUnique({
      where: { id: userId },
      select: { status: true, roles: { select: { name: true } } },
    });
    if (!row || row.status !== 'active' || row.roles.name !== ROLES.STUDENT) {
      throw new BadRequestException({
        message: 'That user is not a valid active student account',
        errorCode: 'STUDENT_NOT_ELIGIBLE',
      });
    }
  }

  private toRequestPayload(
    row: {
      id: bigint;
      sender_user_id: number;
      receiver_user_id: number;
      status: string;
      created_at: Date;
    },
    sender: ReturnType<typeof toMessagePerson> | null,
  ) {
    return {
      requestId: Number(row.id),
      senderUserId: row.sender_user_id,
      receiverUserId: row.receiver_user_id,
      status: row.status,
      sender,
      createdAt: row.created_at.toISOString(),
    };
  }

  // ──────────────────────────── student-to-student chat requests ────────────────────────────

  /** POST /me/messaging/requests (Student only). */
  async sendChatRequest(senderUserId: number, receiverUserId: number) {
    if (receiverUserId === senderUserId) {
      throw new BadRequestException(
        'Cannot send a message request to yourself',
      );
    }
    await this.assertActiveStudent(receiverUserId);

    const key = dmPairKey(senderUserId, receiverUserId);
    const existing = await this.prisma.message_requests.findFirst({
      where: { active_key: key, request_type: 'dm' },
    });
    if (existing) {
      if (existing.status === 'accepted') {
        throw new BadRequestException({
          message: 'You already have an active conversation with this student',
          errorCode: 'REQUEST_ALREADY_ACCEPTED',
          conversationId: existing.conversation_id
            ? Number(existing.conversation_id)
            : null,
        });
      }
      if (existing.sender_user_id === senderUserId) {
        throw new BadRequestException({
          message: 'You already sent this student a message request',
          errorCode: 'REQUEST_ALREADY_PENDING',
        });
      }
      throw new BadRequestException({
        message:
          'This student already sent you a message request — accept it instead',
        errorCode: 'INCOMING_REQUEST_EXISTS',
        requestId: Number(existing.id),
      });
    }

    let created;
    try {
      created = await this.prisma.message_requests.create({
        data: {
          request_type: 'dm',
          sender_user_id: senderUserId,
          receiver_user_id: receiverUserId,
          status: 'pending',
          active_key: key,
        },
      });
    } catch {
      // Race: the other student's own sendChatRequest call (to us) won
      // between our check above and our insert.
      throw new BadRequestException({
        message:
          'This student already sent you a message request — accept it instead',
        errorCode: 'INCOMING_REQUEST_EXISTS',
      });
    }

    const senderRow = await this.prisma.users.findUnique({
      where: { id: senderUserId },
      select: PERSON_SELECT,
    });
    const sender = senderRow ? toMessagePerson(senderRow) : null;

    this.gateway.pushToUser(receiverUserId, 'chat_request:new', {
      request: this.toRequestPayload(created, sender),
    });
    void this.notifications
      .notify({
        user_id: receiverUserId,
        title: sender ? sender.name : 'New message request',
        message: 'sent you a message request',
        type: notification_type_enum.direct_message_received,
        related_entity_type: 'message_request',
        related_entity_id: Number(created.id),
      })
      .catch((err: unknown) =>
        this.logger.error('Chat request notification failed', err),
      );

    return this.toRequestPayload(created, sender);
  }

  /** GET /me/messaging/requests/incoming (Student only). */
  async listIncomingChatRequests(userId: number) {
    const rows = await this.prisma.message_requests.findMany({
      where: { receiver_user_id: userId, request_type: 'dm', status: 'pending' },
      orderBy: { created_at: 'desc' },
      include: { sender: { select: PERSON_SELECT } },
    });
    return rows.map((r) =>
      this.toRequestPayload(r, r.sender ? toMessagePerson(r.sender) : null),
    );
  }

  /** GET /me/messaging/requests/sent (Student only) — so the UI can show "Request Sent". */
  async listSentChatRequests(userId: number) {
    const rows = await this.prisma.message_requests.findMany({
      where: { sender_user_id: userId, request_type: 'dm', status: 'pending' },
      orderBy: { created_at: 'desc' },
      include: { receiver: { select: PERSON_SELECT } },
    });
    return rows.map((r) =>
      this.toRequestPayload(r, r.receiver ? toMessagePerson(r.receiver) : null),
    );
  }

  /** GET /me/messaging/requests/status/:userId (Student only) — the single
   * lookup the "Message" / "Send Message Request" / "Request Sent" /
   * "Accept · Reject" button on another student's profile needs. */
  async getRelationshipStatus(callerUserId: number, otherUserId: number) {
    if (callerUserId === otherUserId) return { status: 'self' as const };

    const row = await this.prisma.message_requests.findFirst({
      where: { active_key: dmPairKey(callerUserId, otherUserId), request_type: 'dm' },
      orderBy: { created_at: 'desc' },
    });
    if (!row) return { status: 'none' as const };
    if (row.status === 'accepted') {
      return {
        status: 'accepted' as const,
        conversationId: row.conversation_id ? Number(row.conversation_id) : null,
      };
    }
    return row.sender_user_id === callerUserId
      ? { status: 'pending_sent' as const, requestId: Number(row.id) }
      : { status: 'pending_received' as const, requestId: Number(row.id) };
  }

  /** POST /me/messaging/requests/:id/accept (Student only, must be the receiver). */
  async acceptChatRequest(receiverUserId: number, requestId: number) {
    const reqRow = await this.prisma.message_requests.findUnique({
      where: { id: requestId },
    });
    if (!reqRow || reqRow.request_type !== 'dm') {
      throw new NotFoundException('Request not found');
    }
    if (reqRow.receiver_user_id !== receiverUserId) {
      throw new ForbiddenException("You cannot act on another student's request");
    }
    if (reqRow.status !== 'pending') {
      throw new BadRequestException('This request is no longer pending');
    }

    const conversation = await this.messaging.materializeDmConversation(
      reqRow.sender_user_id,
      reqRow.receiver_user_id,
      reqRow.sender_user_id,
    );
    await this.prisma.message_requests.update({
      where: { id: requestId },
      data: {
        status: 'accepted',
        conversation_id: conversation.id,
        updated_at: new Date(),
      },
    });

    for (const userId of [reqRow.sender_user_id, reqRow.receiver_user_id]) {
      const summary = await this.messaging.getConversationSummaryForUser(
        conversation.id,
        userId,
      );
      this.gateway.joinUserToConversation(userId, Number(conversation.id));
      this.gateway.pushToUser(userId, 'conversation:new', { conversation: summary });
    }
    this.gateway.pushToUser(reqRow.sender_user_id, 'chat_request:accepted', {
      requestId,
      conversationId: Number(conversation.id),
    });

    return this.messaging.getConversationSummaryForUser(
      conversation.id,
      receiverUserId,
    );
  }

  /** POST /me/messaging/requests/:id/reject (Student only, must be the receiver). */
  async rejectChatRequest(receiverUserId: number, requestId: number) {
    const reqRow = await this.prisma.message_requests.findUnique({
      where: { id: requestId },
    });
    if (!reqRow || reqRow.request_type !== 'dm') {
      throw new NotFoundException('Request not found');
    }
    if (reqRow.receiver_user_id !== receiverUserId) {
      throw new ForbiddenException("You cannot act on another student's request");
    }
    if (reqRow.status !== 'pending') {
      throw new BadRequestException('This request is no longer pending');
    }

    await this.prisma.message_requests.update({
      where: { id: requestId },
      data: { status: 'rejected', active_key: null, updated_at: new Date() },
    });
    this.gateway.pushToUser(reqRow.sender_user_id, 'chat_request:rejected', {
      requestId,
    });

    return { requestId, status: 'rejected' as const };
  }

  // ──────────────────────────── student-created-group invitations ────────────────────────────

  /** GET /me/messaging/group-invites (Student only). */
  async listIncomingGroupInvites(userId: number) {
    const rows = await this.prisma.message_requests.findMany({
      where: {
        receiver_user_id: userId,
        request_type: 'group_invite',
        status: 'pending',
      },
      orderBy: { created_at: 'desc' },
      include: {
        sender: { select: PERSON_SELECT },
        conversation: { select: { id: true, title: true, image_url: true } },
      },
    });
    return rows.map((r) => ({
      requestId: Number(r.id),
      conversationId: r.conversation_id ? Number(r.conversation_id) : null,
      groupTitle: r.conversation?.title ?? null,
      groupImageUrl: r.conversation?.image_url ?? null,
      invitedBy: r.sender ? toMessagePerson(r.sender) : null,
      createdAt: r.created_at.toISOString(),
    }));
  }

  /** POST /me/messaging/group-invites/:id/accept (Student only, must be the invitee). */
  async acceptGroupInvite(receiverUserId: number, requestId: number) {
    const reqRow = await this.prisma.message_requests.findUnique({
      where: { id: requestId },
    });
    if (!reqRow || reqRow.request_type !== 'group_invite' || !reqRow.conversation_id) {
      throw new NotFoundException('Invitation not found');
    }
    if (reqRow.receiver_user_id !== receiverUserId) {
      throw new ForbiddenException(
        "You cannot act on another student's invitation",
      );
    }
    if (reqRow.status !== 'pending') {
      throw new BadRequestException('This invitation is no longer pending');
    }

    const conversationId = reqRow.conversation_id;
    await this.prisma.$transaction(async (tx) => {
      await tx.message_requests.update({
        where: { id: requestId },
        data: { status: 'accepted', active_key: null, updated_at: new Date() },
      });
      await tx.message_participants.upsert({
        where: {
          conversation_id_user_id: {
            conversation_id: conversationId,
            user_id: receiverUserId,
          },
        },
        create: { conversation_id: conversationId, user_id: receiverUserId },
        update: {},
      });
    });

    const conversationIdNum = Number(conversationId);
    this.gateway.joinUserToConversation(receiverUserId, conversationIdNum);
    const summary = await this.messaging.getConversationSummaryForUser(
      conversationId,
      receiverUserId,
    );
    this.gateway.pushToUser(receiverUserId, 'conversation:new', {
      conversation: summary,
    });
    this.gateway.pushToConversation(conversationIdNum, 'conversation:updated', {
      conversationId: conversationIdNum,
      newMemberUserId: receiverUserId,
    });
    this.gateway.pushToUser(reqRow.sender_user_id, 'group_invite:accepted', {
      requestId,
      conversationId: conversationIdNum,
      userId: receiverUserId,
    });

    return this.messaging.getGroupDetails(receiverUserId, conversationIdNum);
  }

  /** POST /me/messaging/group-invites/:id/reject (Student only, must be the invitee). */
  async rejectGroupInvite(receiverUserId: number, requestId: number) {
    const reqRow = await this.prisma.message_requests.findUnique({
      where: { id: requestId },
    });
    if (!reqRow || reqRow.request_type !== 'group_invite') {
      throw new NotFoundException('Invitation not found');
    }
    if (reqRow.receiver_user_id !== receiverUserId) {
      throw new ForbiddenException(
        "You cannot act on another student's invitation",
      );
    }
    if (reqRow.status !== 'pending') {
      throw new BadRequestException('This invitation is no longer pending');
    }

    await this.prisma.message_requests.update({
      where: { id: requestId },
      data: { status: 'rejected', active_key: null, updated_at: new Date() },
    });
    this.gateway.pushToUser(reqRow.sender_user_id, 'group_invite:rejected', {
      requestId,
    });

    return { requestId, status: 'rejected' as const };
  }
}
