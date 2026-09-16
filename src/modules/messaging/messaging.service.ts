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
import { StorageService } from 'src/common/storage/storage.service';
import { STORAGE_BUCKETS } from 'src/common/constants/storage-buckets.constant';
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
import type { CreateGroupConversationDto } from './dto/create-group-conversation.dto';
import type { AddGroupMembersDto } from './dto/add-group-members.dto';
import type { UpdateGroupDto } from './dto/update-group.dto';

/** A student's search/send target is blocked at both layers — this code name is what the client matches on. */
export const STUDENT_TO_STUDENT_BLOCKED = 'STUDENT_TO_STUDENT_BLOCKED';

/** Thrown by assertCanMessage when a student tries to DM another student
 * with no accepted message_requests row between them yet — distinct from
 * STUDENT_TO_STUDENT_BLOCKED (which now only means "no request system was
 * used at all") so the client can point the user at "send a request"
 * specifically, via MessageRequestsService. */
export const STUDENT_REQUEST_REQUIRED = 'STUDENT_REQUEST_REQUIRED';

/** Same limits as students.service.ts's/venues.service.ts's own photo uploads — duplicated per-service rather than shared, matching this codebase's existing convention (see those two files). */
const GROUP_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const GROUP_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** Same normalized-pair-key shape as message_conversations.dm_key, reused as
 * message_requests.active_key for a 'dm'-type request — so "is there an
 * accepted/pending request between these two users" is a single indexed
 * lookup regardless of who sent it. Exported for MessageRequestsService. */
export function dmPairKey(userIdA: number, userIdB: number): string {
  return `dm:${[userIdA, userIdB].sort((a, b) => a - b).join(':')}`;
}

export function personDisplayName(row: {
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

/** Normalizes the two differently-named source columns (students.photo_url,
 * faculty.profile_url) to one output field — same convention already used by
 * ProfileService.getMyProfile for the student/faculty branches. */
function personPhotoUrl(row: {
  faculty?: { profile_url: string | null } | null;
  students?: { photo_url: string | null } | null;
}): string | null {
  if (row.faculty) return row.faculty.profile_url;
  if (row.students) return row.students.photo_url;
  return null;
}

export const PERSON_SELECT = {
  id: true,
  email: true,
  roles: { select: { name: true } },
  faculty: {
    select: {
      first_name: true,
      last_name: true,
      designation: true,
      profile_url: true,
      departments: { select: { name: true, code: true } },
    },
  },
  students: {
    select: {
      photo_url: true,
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
} as const;

export function toMessagePerson(row: {
  id: number;
  email: string;
  roles: { name: string };
  faculty: {
    first_name: string;
    last_name: string;
    designation: string;
    profile_url: string | null;
    departments: { name: string; code: string };
  } | null;
  students: {
    photo_url: string | null;
    classes: { section: string; departments: { code: string } } | null;
    soa_applications: { first_name: string; last_name: string | null } | null;
  } | null;
}) {
  return {
    userId: row.id,
    name: personDisplayName(row),
    roleLabel: personRoleLabel(row),
    photoUrl: personPhotoUrl(row),
  };
}

@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly presence: PresenceService,
    private readonly storage: StorageService,
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
   * Enforced on the conversation-creation path (message:send re-checks
   * separately inline, see sendMessage — it already has the other party's
   * role in hand from its own combined fetch and doesn't need this). A
   * student messaging a non-student is unchanged/unrestricted. A student
   * messaging another student now requires an ACCEPTED message_requests row
   * between them (see MessageRequestsService) instead of being blocked
   * outright — STUDENT_TO_STUDENT_BLOCKED still fires for two students with
   * no request history at all; STUDENT_REQUEST_REQUIRED fires once a request
   * exists but isn't accepted yet (pending/rejected), so the client can point
   * the user at the request flow specifically.
   */
  async assertCanMessage(
    callerUserId: number,
    senderRole: string,
    otherUserId: number,
  ): Promise<void> {
    if (senderRole !== ROLES.STUDENT) return;
    const other = await this.prisma.users.findUnique({
      where: { id: otherUserId },
      select: { roles: { select: { name: true } } },
    });
    if (!other) throw new NotFoundException('User not found');
    if (other.roles.name !== ROLES.STUDENT) return;

    const accepted = await this.prisma.message_requests.findFirst({
      where: {
        active_key: dmPairKey(callerUserId, otherUserId),
        request_type: 'dm',
        status: 'accepted',
      },
      select: { id: true },
    });
    if (accepted) return;

    const hasHistory = await this.prisma.message_requests.findFirst({
      where: { active_key: dmPairKey(callerUserId, otherUserId), request_type: 'dm' },
      select: { id: true },
    });
    throw new ForbiddenException({
      message: hasHistory
        ? 'This message request has not been accepted yet'
        : 'Students cannot message other students directly — send a message request first',
      errorCode: hasHistory ? STUDENT_REQUEST_REQUIRED : STUDENT_TO_STUDENT_BLOCKED,
    });
  }

  /**
   * Creates (or returns the existing) DM conversation for this pair via the
   * same dm_key mechanism as getOrCreateConversation, WITHOUT the
   * assertCanMessage gate — the caller (MessageRequestsService's
   * acceptChatRequest) has already verified an accepted request exists,
   * which is itself the authorization check for a student-student pair.
   */
  async materializeDmConversation(
    userIdA: number,
    userIdB: number,
    createdByUserId: number,
  ) {
    const dmKey = [userIdA, userIdB].sort((a, b) => a - b).join(':');
    const existing = await this.prisma.message_conversations.findUnique({
      where: { dm_key: dmKey },
    });
    if (existing) return existing;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const conversation = await tx.message_conversations.create({
          data: { dm_key: dmKey, created_by_user_id: createdByUserId },
        });
        await tx.message_participants.createMany({
          data: [
            { conversation_id: conversation.id, user_id: userIdA },
            { conversation_id: conversation.id, user_id: userIdB },
          ],
        });
        return conversation;
      });
    } catch {
      return this.prisma.message_conversations.findUniqueOrThrow({
        where: { dm_key: dmKey },
      });
    }
  }

  /** Public wrapper — MessageRequestsService needs the same summary shape
   * after materializing/accepting a conversation but toConversationSummary
   * itself stays private to this class. */
  async getConversationSummaryForUser(
    conversationId: bigint | number,
    userId: number,
  ) {
    return this.toConversationSummary(conversationId, userId);
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
        // A student CAN find another student here now — search visibility
        // and messaging permission are separate concerns since student-
        // student chat requires an accepted message_requests row (see
        // assertCanMessage/MessageRequestsService); finding someone to send
        // a request to is exactly what this search is for. callerRole is
        // kept as a parameter (unused here now) for that reason, and in case
        // a future role-specific restriction is needed again.
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
          // Same "find a student by their name" search box also needs to
          // match on roll/register number, not just name - these are how a
          // faculty/HoD/etc. most often actually identifies a student.
          {
            students: {
              OR: [
                { student_id_no: { contains: q, mode: 'insensitive' } },
                { roll_no: { contains: q, mode: 'insensitive' } },
                { register_no: { contains: q, mode: 'insensitive' } },
              ],
            },
          },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      take: 20,
      select: PERSON_SELECT,
    });

    return rows.map(toMessagePerson);
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
                  profile_url: true,
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
              profile_url: true,
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
        profile_url: string | null;
        departments: { code: string };
      },
      label: string,
    ) => ({
      userId: f.user_id,
      name: `${f.first_name} ${f.last_name}`.trim(),
      roleLabel: `${f.designation} · ${f.departments.code}`,
      photoUrl: f.profile_url,
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
    await this.assertCanMessage(callerUserId, callerRole, otherUserId);

    // Deliberately no push to the other participant here, and this row stays
    // excluded from listConversations() until a message actually exists (or,
    // for an accepted student-student request, is already covered by that
    // request's own visibility branch — see listConversations) — starting a
    // chat must stay invisible to the other side until the first message is
    // sent (see sendMessage's first-message branch).
    const conversation = await this.materializeDmConversation(
      callerUserId,
      otherUserId,
      callerUserId,
    );
    return this.toConversationSummary(conversation.id, callerUserId);
  }

  // ──────────────────────────── groups (faculty/HoD + student-created) ────────────────────────────

  /**
   * GET /me/messaging/contacts/eligible-students (Faculty/HoD/Student — role
   * gated at the controller). Any active student in the college, regardless
   * of department/year/section/class/subject — used both for Faculty/HoD
   * group creation AND student group creation/chat-request search, which is
   * exactly why this no longer scopes by the caller's own
   * faculty_subject_class_mapping. Without a search term this returns a
   * capped, name-ordered page rather than all ~3000+ students at once; `q`
   * searches the full student directory by name/roll/register no./email,
   * mirroring searchPeople's own matching.
   */
  async getEligibleStudents(callerUserId: number, q?: string) {
    const trimmed = q?.trim();
    const rows = await this.prisma.users.findMany({
      where: {
        id: { not: callerUserId },
        status: 'active',
        roles: { name: ROLES.STUDENT },
        ...(trimmed && {
          OR: [
            {
              students: {
                soa_applications: {
                  OR: [
                    { first_name: { contains: trimmed, mode: 'insensitive' } },
                    { last_name: { contains: trimmed, mode: 'insensitive' } },
                  ],
                },
              },
            },
            {
              students: {
                OR: [
                  { student_id_no: { contains: trimmed, mode: 'insensitive' } },
                  { roll_no: { contains: trimmed, mode: 'insensitive' } },
                  { register_no: { contains: trimmed, mode: 'insensitive' } },
                ],
              },
            },
            { email: { contains: trimmed, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { id: 'asc' },
      take: 50,
      select: PERSON_SELECT,
    });

    return rows.map(toMessagePerson);
  }

  /** Throws unless every id in studentUserIds resolves to a real, active
   * student account. This is the one non-negotiable server-side enforcement
   * point for group membership — it no longer checks the caller's own
   * faculty_subject_class_mapping (a Faculty/HoD may add any student in the
   * college), but a client-supplied id list is still never trusted as-is:
   * every id must actually exist as an active student user. */
  private async assertStudentsEligible(
    studentUserIds: number[],
  ): Promise<void> {
    const rows = await this.prisma.users.findMany({
      where: {
        id: { in: studentUserIds },
        status: 'active',
        roles: { name: ROLES.STUDENT },
      },
      select: { id: true },
    });
    const validIds = new Set(rows.map((r) => r.id));
    const invalid = studentUserIds.filter((id) => !validIds.has(id));
    if (invalid.length > 0) {
      throw new BadRequestException({
        message:
          'One or more selected users are not valid active student accounts',
        errorCode: 'STUDENT_NOT_ELIGIBLE',
        ineligibleUserIds: invalid,
      });
    }
  }

  private async loadOwnedGroup(callerUserId: number, conversationId: number) {
    const conversation = await this.prisma.message_conversations.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Group not found');
    if (!conversation.is_group)
      throw new BadRequestException('This conversation is not a group');
    if (conversation.created_by_user_id !== callerUserId)
      throw new ForbiddenException('Only the group owner can do this');
    return conversation;
  }

  /**
   * Creates a pending message_requests('group_invite') row per target and
   * pushes group_invite:new to each — the student-owner counterpart of the
   * Faculty/HoD "add straight to message_participants" path. A target with
   * an already-pending invite to this same group is silently skipped (same
   * idempotent shape as the Faculty/HoD immediate-add's existingIds filter),
   * caught via the unique active_key rather than pre-queried, so a race
   * between two concurrent invite attempts can't double-invite either.
   */
  private async createGroupInvites(
    senderUserId: number,
    conversationId: number,
    targetUserIds: number[],
  ): Promise<void> {
    if (targetUserIds.length === 0) return;

    const [conversation, senderInfo] = await Promise.all([
      this.prisma.message_conversations.findUnique({
        where: { id: conversationId },
        select: { title: true, image_url: true },
      }),
      this.prisma.users.findUnique({
        where: { id: senderUserId },
        select: PERSON_SELECT,
      }),
    ]);
    const inviter = senderInfo ? toMessagePerson(senderInfo) : null;

    for (const receiverUserId of targetUserIds) {
      let invite;
      try {
        invite = await this.prisma.message_requests.create({
          data: {
            request_type: 'group_invite',
            sender_user_id: senderUserId,
            receiver_user_id: receiverUserId,
            conversation_id: conversationId,
            status: 'pending',
            active_key: `group:${conversationId}:${receiverUserId}`,
          },
        });
      } catch {
        // Unique violation on active_key — this student already has a
        // pending invite to this group. Not an error, just a no-op.
        continue;
      }

      this.gateway.pushToUser(receiverUserId, 'group_invite:new', {
        requestId: Number(invite.id),
        conversationId,
        groupTitle: conversation?.title ?? null,
        groupImageUrl: conversation?.image_url ?? null,
        invitedBy: inviter,
      });
      void this.notifications
        .notify({
          user_id: receiverUserId,
          title: inviter ? inviter.name : 'Group invitation',
          message: `invited you to join "${conversation?.title ?? 'a group'}"`,
          type: notification_type_enum.direct_message_received,
          related_entity_type: 'message_request',
          related_entity_id: Number(invite.id),
        })
        .catch((err: unknown) =>
          this.logger.error('Group invite notification failed', err),
        );
    }
  }

  /**
   * POST /me/messaging/conversations/group (Faculty/HoD/Student — role
   * gated at the controller; behavior branches on callerRole here).
   * Faculty/HoD: unchanged — every selected student becomes an active
   * participant immediately, group visible to everyone right away (not
   * deferred until a first message, unlike a DM). Student: the CALLER is
   * the only immediate participant/owner; every selected student instead
   * gets a pending group_invite (see createGroupInvites) and only becomes
   * an active participant after accepting (see
   * MessageRequestsService.acceptGroupInvite) — per spec, a student creating
   * a group must never auto-add another student as an active member. The
   * creator sees the group immediately either way.
   */
  async createGroupConversation(
    callerUserId: number,
    callerRole: string,
    dto: CreateGroupConversationDto,
  ) {
    const targetIds = [...new Set(dto.studentUserIds)].filter(
      (id) => id !== callerUserId,
    );
    await this.assertStudentsEligible(targetIds);

    const created = await this.prisma.$transaction(async (tx) => {
      const conversation = await tx.message_conversations.create({
        data: { is_group: true, title: dto.title, created_by_user_id: callerUserId },
      });
      await tx.message_participants.create({
        data: { conversation_id: conversation.id, user_id: callerUserId },
      });
      return conversation;
    });
    const conversationId = Number(created.id);

    if (callerRole === ROLES.FACULTY || callerRole === ROLES.HOD) {
      if (targetIds.length > 0) {
        await this.prisma.message_participants.createMany({
          data: targetIds.map((userId) => ({
            conversation_id: created.id,
            user_id: userId,
          })),
        });
        for (const memberId of targetIds) {
          const summary = await this.toConversationSummary(created.id, memberId);
          this.gateway.joinUserToConversation(memberId, conversationId);
          this.gateway.pushToUser(memberId, 'conversation:new', {
            conversation: summary,
          });
        }
      }
    } else {
      await this.createGroupInvites(callerUserId, conversationId, targetIds);
    }

    return this.toConversationSummary(created.id, callerUserId);
  }

  /** POST /me/messaging/conversations/:id/members (Faculty/HoD/Student, owner only). Faculty/HoD: unchanged immediate add. Student owner: pending group_invite per target instead (see createGroupInvites) — idempotent against both already-active members and already-pending invites. */
  async addGroupMembers(
    callerUserId: number,
    callerRole: string,
    conversationId: number,
    dto: AddGroupMembersDto,
  ) {
    await this.loadOwnedGroup(callerUserId, conversationId);
    const targetIds = [...new Set(dto.studentUserIds)].filter(
      (id) => id !== callerUserId,
    );
    await this.assertStudentsEligible(targetIds);

    const existing = await this.prisma.message_participants.findMany({
      where: {
        conversation_id: conversationId,
        user_id: { in: targetIds },
      },
      select: { user_id: true },
    });
    const existingIds = new Set(existing.map((p) => p.user_id));
    const newIds = targetIds.filter((id) => !existingIds.has(id));

    if (callerRole === ROLES.FACULTY || callerRole === ROLES.HOD) {
      if (newIds.length > 0) {
        await this.prisma.message_participants.createMany({
          data: newIds.map((userId) => ({
            conversation_id: conversationId,
            user_id: userId,
          })),
        });
        for (const memberId of newIds) {
          const summary = await this.toConversationSummary(
            conversationId,
            memberId,
          );
          this.gateway.joinUserToConversation(memberId, conversationId);
          this.gateway.pushToUser(memberId, 'conversation:new', {
            conversation: summary,
          });
        }
      }
    } else {
      const existingInvites = await this.prisma.message_requests.findMany({
        where: {
          conversation_id: conversationId,
          receiver_user_id: { in: newIds },
          request_type: 'group_invite',
          status: 'pending',
        },
        select: { receiver_user_id: true },
      });
      const alreadyInvited = new Set(
        existingInvites.map((r) => r.receiver_user_id),
      );
      await this.createGroupInvites(
        callerUserId,
        conversationId,
        newIds.filter((id) => !alreadyInvited.has(id)),
      );
    }

    return this.getGroupDetails(callerUserId, conversationId);
  }

  /** DELETE /me/messaging/conversations/:id/members/:userId (Faculty/HoD/Student, owner only). Hard-deletes the participant row — no removed_at column, matching this table's existing no-soft-delete convention; sender_user_id on past messages is an independent FK so remaining members' history is unaffected. If the target isn't an active member but DOES have a pending group_invite (student-owned groups only — Faculty/HoD never creates one), this also doubles as "cancel invitation" instead of 404ing, since the owner has no other way to un-invite someone who hasn't answered yet. */
  async removeGroupMember(
    callerUserId: number,
    conversationId: number,
    targetUserId: number,
  ) {
    const conversation = await this.loadOwnedGroup(
      callerUserId,
      conversationId,
    );
    if (targetUserId === conversation.created_by_user_id) {
      throw new BadRequestException(
        'The group owner cannot be removed this way — delete the group instead',
      );
    }

    const participant = await this.prisma.message_participants.findUnique({
      where: {
        conversation_id_user_id: {
          conversation_id: conversationId,
          user_id: targetUserId,
        },
      },
    });

    if (participant) {
      await this.prisma.message_participants.delete({
        where: {
          conversation_id_user_id: {
            conversation_id: conversationId,
            user_id: targetUserId,
          },
        },
      });
      this.gateway.leaveUserFromConversation(targetUserId, conversationId);
      this.gateway.pushToConversation(conversationId, 'conversation:updated', {
        conversationId,
        removedUserId: targetUserId,
      });
      return this.getGroupDetails(callerUserId, conversationId);
    }

    const pendingInvite = await this.prisma.message_requests.findFirst({
      where: {
        conversation_id: conversationId,
        receiver_user_id: targetUserId,
        request_type: 'group_invite',
        status: 'pending',
      },
    });
    if (!pendingInvite) {
      throw new NotFoundException('That user is not a member of this group');
    }
    await this.prisma.message_requests.update({
      where: { id: pendingInvite.id },
      data: { status: 'cancelled', active_key: null, updated_at: new Date() },
    });
    this.gateway.pushToUser(targetUserId, 'group_invite:cancelled', {
      requestId: Number(pendingInvite.id),
      conversationId,
    });

    return this.getGroupDetails(callerUserId, conversationId);
  }

  /** PATCH /me/messaging/conversations/:id (Faculty/HoD, owner only). */
  async updateGroup(
    callerUserId: number,
    conversationId: number,
    dto: UpdateGroupDto,
  ) {
    await this.loadOwnedGroup(callerUserId, conversationId);
    if (dto.title !== undefined) {
      await this.prisma.message_conversations.update({
        where: { id: conversationId },
        data: { title: dto.title },
      });
    }
    const details = await this.getGroupDetails(callerUserId, conversationId);
    this.gateway.pushToConversation(conversationId, 'conversation:updated', {
      conversationId,
      title: details.title,
      imageUrl: details.imageUrl,
    });
    return details;
  }

  /** POST /me/messaging/conversations/:id/image (Faculty/HoD, owner only, multipart). Clones AdmissionsStudentsService.uploadPhoto's exact validation/upload/replace shape. */
  async uploadGroupImage(
    callerUserId: number,
    conversationId: number,
    file: Express.Multer.File,
  ) {
    const conversation = await this.loadOwnedGroup(
      callerUserId,
      conversationId,
    );
    if (!GROUP_IMAGE_MIME_TYPES.includes(file.mimetype)) {
      throw new BadRequestException({
        message: `That file type is not accepted. JPG, PNG or WebP only — got ${file.mimetype || 'an unknown type'}.`,
        errorCode: 'INVALID_PHOTO_TYPE',
      });
    }
    if (file.size > GROUP_IMAGE_MAX_BYTES) {
      throw new BadRequestException({
        message: `File is too large — the limit is ${GROUP_IMAGE_MAX_BYTES / (1024 * 1024)}MB.`,
        errorCode: 'PHOTO_TOO_LARGE',
      });
    }

    const { key } = await this.storage.upload(
      `groups/${conversationId}`,
      file.originalname,
      file.buffer,
      file.mimetype,
      STORAGE_BUCKETS.GROUP_PHOTOS,
    );
    const imageUrl = this.storage.getPublicUrl(key, STORAGE_BUCKETS.GROUP_PHOTOS);
    const oldKey = this.extractStorageKey(
      conversation.image_url,
      STORAGE_BUCKETS.GROUP_PHOTOS,
    );

    await this.prisma.message_conversations.update({
      where: { id: conversationId },
      data: { image_url: imageUrl },
    });

    if (oldKey) {
      try {
        await this.storage.delete(oldKey, STORAGE_BUCKETS.GROUP_PHOTOS);
      } catch (err) {
        this.logger.warn(
          `Old group image cleanup failed for conversation ${conversationId} (new image already saved): ${err}`,
        );
      }
    }

    const details = await this.getGroupDetails(callerUserId, conversationId);
    this.gateway.pushToConversation(conversationId, 'conversation:updated', {
      conversationId,
      title: details.title,
      imageUrl: details.imageUrl,
    });
    return details;
  }

  /** Reverses getPublicUrl()'s construction — null on any URL that doesn't match this bucket's public-URL shape (nothing to delete, not an error). Same helper shape as students.service.ts's own extractStorageKey. */
  private extractStorageKey(url: string | null, bucket: string): string | null {
    if (!url) return null;
    const marker = `/storage/v1/object/public/${bucket}/`;
    const index = url.indexOf(marker);
    return index === -1 ? null : url.slice(index + marker.length);
  }

  /** DELETE /me/messaging/conversations/:id (Faculty/HoD, owner only). Hard delete — messages/message_participants cascade via their FKs (onDelete: Cascade, confirmed in schema.prisma), no manual multi-step transaction needed. Pushes conversation:deleted BEFORE deleting so still-connected sockets receive it. */
  async deleteGroup(callerUserId: number, conversationId: number) {
    await this.loadOwnedGroup(callerUserId, conversationId);
    this.gateway.pushToConversation(conversationId, 'conversation:deleted', {
      conversationId,
    });
    await this.prisma.message_conversations.delete({
      where: { id: conversationId },
    });
    return { conversationId };
  }

  /** GET /me/messaging/conversations/:id (any current participant). */
  async getGroupDetails(callerUserId: number, conversationId: number) {
    await this.assertParticipant(conversationId, callerUserId);

    const conversation = await this.prisma.message_conversations.findUnique({
      where: { id: conversationId },
      include: {
        message_participants: {
          include: { users: { select: PERSON_SELECT } },
        },
      },
    });
    if (!conversation) throw new NotFoundException('Group not found');
    const isOwner = conversation.created_by_user_id === callerUserId;

    // Pending invitees are NOT active members and must never appear in
    // `members`/count as one — only the owner sees who's still pending
    // (a non-owner member has no action to take on it anyway).
    const pendingInvites = isOwner
      ? await this.prisma.message_requests
          .findMany({
            where: {
              conversation_id: conversationId,
              request_type: 'group_invite',
              status: 'pending',
            },
            include: { receiver: { select: PERSON_SELECT } },
          })
          .then((rows) =>
            rows
              .filter((r) => r.receiver !== null)
              .map((r) => toMessagePerson(r.receiver)),
          )
      : [];

    return {
      id: Number(conversation.id),
      title: conversation.title,
      imageUrl: conversation.image_url,
      isGroup: conversation.is_group,
      isOwner,
      memberCount: conversation.message_participants.length,
      members: conversation.message_participants
        .filter((p) => p.users !== null)
        .map((p) => ({
          ...toMessagePerson(p.users),
          isOwner: p.user_id === conversation.created_by_user_id,
        })),
      pendingInvites,
    };
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
          // A DM that was only ever created (e.g. clicked into from search)
          // but never actually sent a message stays invisible — to both
          // participants — until the first message lands. A GROUP is
          // visible to its members immediately on creation instead (see
          // createGroupConversation), so it's exempt from this gate. So is a
          // DM that exists because a student-student message_requests row
          // was just ACCEPTED — mutual consent already happened, so there's
          // no reason to also hide it until a first message (see
          // MessageRequestsService.acceptChatRequest).
          OR: [
            { last_message_id: { not: null } },
            { is_group: true },
            { message_requests: { some: { status: 'accepted' } } },
          ],
          ...(beforeCursor && {
            last_message_at: { lt: beforeCursor.last_message_at ?? undefined },
          }),
        },
      },
      select: {
        conversation_id: true,
        is_pinned: true,
        message_conversations: {
          select: {
            last_message_id: true,
            last_message_at: true,
            is_group: true,
            title: true,
            image_url: true,
          },
        },
      },
      orderBy: { message_conversations: { last_message_at: 'desc' } },
      take: limit,
    });
    if (myParticipation.length === 0) return [];

    const conversationIds = myParticipation.map((p) => p.conversation_id);
    const dmConversationIds = myParticipation
      .filter((p) => !p.message_conversations.is_group)
      .map((p) => p.conversation_id);
    const groupConversationIds = myParticipation
      .filter((p) => p.message_conversations.is_group)
      .map((p) => p.conversation_id);

    // Always run (Prisma returns [] for an empty `in:` array) rather than
    // conditionally skipping the query — a conditional Promise.resolve([])
    // fallback here made TypeScript collapse these queries' element types
    // to `{}` across the two branches, silently breaking every downstream
    // field access.
    const [otherParticipants, groupMemberCounts, unreadRows] = await Promise.all([
      // Only meaningful for DMs — a group has no single "other participant".
      this.prisma.message_participants.findMany({
        where: {
          conversation_id: { in: dmConversationIds },
          user_id: { not: callerUserId },
        },
        select: { conversation_id: true, users: { select: PERSON_SELECT } },
      }),
      this.prisma.message_participants.groupBy({
        by: ['conversation_id'],
        where: { conversation_id: { in: groupConversationIds } },
        _count: { _all: true },
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
    const memberCountByConversation = new Map(
      groupMemberCounts.map((r) => [r.conversation_id.toString(), r._count._all]),
    );
    const lastMessageById = new Map(
      lastMessages.map((m) => [m.id.toString(), m]),
    );
    const unreadByConversation = new Map(
      unreadRows.map((r) => [r.conversation_id.toString(), Number(r.count)]),
    );

    const summaries = myParticipation
      .map((p) => {
        const key = p.conversation_id.toString();
        const lastMessageId = p.message_conversations.last_message_id;
        const lastMessage = lastMessageId
          ? lastMessageById.get(lastMessageId.toString())
          : null;
        const lastMessagePayload = lastMessage
          ? {
              id: Number(lastMessage.id),
              body: lastMessage.is_deleted_for_everyone
                ? null
                : lastMessage.body,
              isDeleted: lastMessage.is_deleted_for_everyone,
              senderUserId: lastMessage.sender_user_id,
              createdAt: lastMessage.created_at.toISOString(),
            }
          : null;

        if (p.message_conversations.is_group) {
          return {
            id: Number(p.conversation_id),
            isGroup: true as const,
            title: p.message_conversations.title,
            imageUrl: p.message_conversations.image_url,
            memberCount: memberCountByConversation.get(key) ?? 0,
            otherUser: null,
            lastMessage: lastMessagePayload,
            lastMessageAt:
              p.message_conversations.last_message_at?.toISOString() ?? null,
            unreadCount: unreadByConversation.get(key) ?? 0,
            isPinned: p.is_pinned,
          };
        }

        const otherUser = otherByConversation.get(key);
        if (!otherUser) return null;

        return {
          id: Number(p.conversation_id),
          isGroup: false as const,
          title: null,
          imageUrl: null,
          otherUser: toMessagePerson(otherUser),
          lastMessage: lastMessagePayload,
          lastMessageAt:
            p.message_conversations.last_message_at?.toISOString() ?? null,
          unreadCount: unreadByConversation.get(key) ?? 0,
          isPinned: p.is_pinned,
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);

    // Pinned first, unpinned after — a stable sort (guaranteed by the spec
    // since ES2019) only moves pinned rows to the front without disturbing
    // the latest-message ordering already applied by the query's own
    // orderBy within each of the two groups, exactly the "preserve existing
    // ordering within each section" requirement.
    summaries.sort((a, b) => Number(b.isPinned) - Number(a.isPinned));

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

  /** Branches on is_group — a group has no single "other participant" (that
   * assumption used to make this return null for any conversation with more
   * than 2 members). */
  private async toConversationSummary(
    conversationId: bigint | number,
    callerUserId: number,
  ) {
    const conversation = await this.prisma.message_conversations.findUnique({
      where: { id: conversationId },
      include: {
        message_participants: {
          include: { users: { select: PERSON_SELECT } },
        },
      },
    });
    if (!conversation) return null;

    const me = conversation.message_participants.find(
      (p) => p.user_id === callerUserId,
    );

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

    const lastMessagePayload = lastMessage
      ? {
          id: Number(lastMessage.id),
          body: lastMessage.is_deleted_for_everyone ? null : lastMessage.body,
          isDeleted: lastMessage.is_deleted_for_everyone,
          senderUserId: lastMessage.sender_user_id,
          createdAt: lastMessage.created_at.toISOString(),
        }
      : null;

    if (conversation.is_group) {
      return {
        id: Number(conversation.id),
        isGroup: true as const,
        title: conversation.title,
        imageUrl: conversation.image_url,
        memberCount: conversation.message_participants.length,
        otherUser: null,
        lastMessage: lastMessagePayload,
        lastMessageAt: conversation.last_message_at?.toISOString() ?? null,
        unreadCount: unread,
        isPinned: me?.is_pinned ?? false,
      };
    }

    const otherParticipant = conversation.message_participants.find(
      (p) => p.user_id !== callerUserId,
    );
    if (!otherParticipant) return null;

    return {
      id: Number(conversation.id),
      isGroup: false as const,
      title: null,
      imageUrl: null,
      otherUser: toMessagePerson(otherParticipant.users),
      lastMessage: lastMessagePayload,
      lastMessageAt: conversation.last_message_at?.toISOString() ?? null,
      unreadCount: unread,
      isPinned: me?.is_pinned ?? false,
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
    const others = conversation.message_participants.filter(
      (p) => p.user_id !== senderUserId,
    );
    if (others.length === 0)
      throw new NotFoundException('Conversation has no recipient');

    // The student-can't-message-student rule is a DM-only concept — a
    // faculty-created class group is definitionally a place students in it
    // message each other, that's the whole point of the group.
    // assertParticipant (already checked via `me` above) is the real gate
    // for groups. For a DM (exactly one other participant), keep the
    // existing rule, re-checked on every send rather than cached from
    // conversation-creation time — closes the race where a role changes
    // after the conversation exists. The recipient's CURRENT role came back
    // with the query above, so this is a pure in-memory check for every case
    // except student-to-student, where an accepted message_requests row can
    // legitimately unblock sending (see assertCanMessage/
    // MessageRequestsService.acceptChatRequest) — that one extra indexed
    // lookup only runs on this specific, comparatively rare pairing.
    if (!conversation.is_group) {
      const otherRoleName = others[0].users.roles.name;
      if (senderRole === ROLES.STUDENT && otherRoleName === ROLES.STUDENT) {
        const accepted = await this.prisma.message_requests.findFirst({
          where: {
            active_key: dmPairKey(senderUserId, others[0].user_id),
            request_type: 'dm',
            status: 'accepted',
          },
          select: { id: true },
        });
        if (!accepted) {
          throw new ForbiddenException({
            message: 'Students cannot message other students',
            errorCode: STUDENT_TO_STUDENT_BLOCKED,
          });
        }
      } else {
        this.assertRoleAllowsMessaging(senderRole, otherRoleName);
      }
    }

    const isFirstMessage =
      !conversation.is_group && conversation.last_message_id === null;
    // Delivered/read is a single global status per message — meaningful for
    // a DM's one other party, meaningless once there are several ("delivered
    // to whom?"). Groups always send as 'sent'; per-participant read truth
    // still lives in message_participants.last_read_message_id, unchanged.
    const recipientOnline =
      !conversation.is_group && this.presence.isOnline(others[0].user_id);

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

    // Everything below is a side effect for the OTHER participant(s) (making
    // a brand-new DM visible to them, or notifying them offline) — none of
    // it changes what the sender's own ack contains, so it runs after the
    // response is already on its way back rather than adding its latency to
    // the send the user is sitting there waiting on.
    void this.runPostSendSideEffects(
      dto,
      senderUserId,
      others.map((o) => o.user_id),
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
    otherUserIds: number[],
    isFirstMessage: boolean,
    recipientOnline: boolean,
  ): Promise<void> {
    const senderInfoPromise = this.prisma.users.findUnique({
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
    });

    await Promise.all([
      // The conversation only becomes visible to a DM's other party once a
      // real message exists in it (see getOrCreateConversation /
      // listConversations) — this is the moment that first happens, so push
      // the full summary (their `user:<id>` room, not the conversation room
      // they haven't joined yet) and join their sockets to the room for
      // future live pushes. Groups are already visible/joined from creation
      // (see createGroupConversation/addGroupMembers), so this never fires
      // for a group.
      isFirstMessage
        ? this.toConversationSummary(dto.conversationId, otherUserIds[0]).then(
            (summaryForRecipient) => {
              this.gateway.joinUserToConversation(
                otherUserIds[0],
                Number(dto.conversationId),
              );
              this.gateway.pushToUser(otherUserIds[0], 'conversation:new', {
                conversation: summaryForRecipient,
              });
            },
          )
        : Promise.resolve(),
      // Offline notification for every other participant who isn't online
      // (a DM has exactly one; a group may have many — recipientOnline is
      // only ever true for a DM's single party, so a group's members always
      // go through this branch).
      recipientOnline
        ? Promise.resolve()
        : senderInfoPromise.then((senderInfo) =>
            Promise.all(
              otherUserIds.map((recipientUserId) =>
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
            ),
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

  /**
   * PATCH /me/messaging/conversations/:id/pin and .../unpin (any current
   * participant — pinning is a personal list preference, not an owner-only
   * group-management action). Lives entirely on the caller's OWN
   * message_participants row (same personal-preference column shape as
   * is_muted, already on this table) — never touches
   * message_conversations.last_message_at, and is never visible to any
   * other participant's own listConversations()/toConversationSummary()
   * call. assertParticipant is the only authorization this needs: a removed
   * member has no row here to pin, and a non-member never had one.
   */
  async setConversationPinned(
    callerUserId: number,
    conversationId: number,
    pinned: boolean,
  ) {
    await this.assertParticipant(conversationId, callerUserId);
    await this.prisma.message_participants.update({
      where: {
        conversation_id_user_id: {
          conversation_id: conversationId,
          user_id: callerUserId,
        },
      },
      data: { is_pinned: pinned, pinned_at: pinned ? new Date() : null },
    });

    const summary = await this.toConversationSummary(conversationId, callerUserId);
    // Personal-room push only (never pushToConversation) — keeps every other
    // participant's socket completely unaware of this, while still syncing
    // the caller's own other open devices/tabs immediately.
    this.gateway.pushToUser(callerUserId, 'conversation:updated', {
      conversationId,
      isPinned: pinned,
    });
    return summary;
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
