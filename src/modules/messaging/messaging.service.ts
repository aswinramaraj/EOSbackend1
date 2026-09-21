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
import { buildMultiWordNameWhere } from 'src/common/utils/name-search.util';
import { notification_type_enum } from '../../../generated/prisma/enums';
import { Prisma } from '../../../generated/prisma/client';
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

/**
 * Shared operational accounts with no messaging use case at all — never
 * reachable through search or a direct message, from any sender. Add a new
 * role here (and to its own frontend nav.ts's `excludeMessages: true`) any
 * time a similar single-shared-login role is introduced.
 */
const MESSAGING_EXCLUDED_ROLES: string[] = [
  ROLES.CANTEEN_ADMIN,
  ROLES.CANTEEN_CASHIER,
];

/**
 * Human-friendly labels for "office" accounts — a role with no linked
 * faculty/student profile row (principal, admin, coe, billing, ...), so
 * `users` has nothing but a raw email to identify them by. Without this,
 * personDisplayName's only option was the literal email, and
 * personRoleLabel's only option was the raw snake_case role slug directly
 * underneath it — e.g. "principal@sece.ac.in" over "principal", the same
 * word twice. Any role not listed here (a legacy/unseeded one) still gets a
 * reasonable label from the Title Case fallback below, never a raw slug.
 */
const OFFICE_ROLE_LABEL: Record<string, string> = {
  admin: 'Admin',
  principal: 'Principal',
  coe: 'Controller of Examinations',
  placement: 'Placement Cell',
  library: 'Library',
  billing: 'Billing',
  hr_payroll: 'HR & Payroll',
  finance: 'Finance',
  iqac: 'IQAC',
  secretary: 'Secretary',
  gate_warden: 'Gate Warden',
  warden: 'Hostel Warden',
  media_room: 'Media Room',
  academic_coordinator: 'Academic Coordinator',
  alumni: 'Alumni',
  non_teaching_staff: 'Non-Teaching Staff',
  transport: 'Transport',
  higheredu: 'Higher Education',
  medical_centre: 'Medical Centre',
  sports_admin: 'Sports Admin',
  edc_coordinator: 'EDC Coordinator',
  parent: 'Parent',
};

function humanizeRoleName(roleName: string): string {
  return (
    OFFICE_ROLE_LABEL[roleName] ??
    roleName
      .split('_')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ')
  );
}

function personDisplayName(row: {
  roles: { name: string };
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
  // No personal profile exists for this role (principal, admin, billing,
  // ...) — the role itself IS their identity, so it's the name, not a
  // subtitle repeating what the (unreadable) email already implied.
  return humanizeRoleName(row.roles.name);
}

const ROMAN_YEAR = ['I', 'II', 'III', 'IV', 'V', 'VI'];

/**
 * Semesters 1-2 -> "I", 3-4 -> "II", 5-6 -> "III", etc. Mirrors
 * EOS-web-frontend's src/lib/utils/academic.ts#yearLabelForSemester — kept
 * as its own copy since the two apps don't share code, but must stay in
 * sync with it.
 */
function yearLabelForSemester(
  semester: number | null | undefined,
): string | null {
  if (semester == null) return null;
  const yearIndex = Math.ceil(semester / 2) - 1;
  return ROMAN_YEAR[yearIndex] ?? String(yearIndex + 1);
}

function personRoleLabel(row: {
  roles: { name: string };
  email: string;
  faculty?: {
    designation: string;
    departments: { name: string; code: string };
  } | null;
  students?: {
    classes: {
      section: string;
      current_semester: number | null;
      departments: { code: string };
    } | null;
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
      cls
        ? [
            yearLabelForSemester(cls.current_semester)
              ? `${yearLabelForSemester(cls.current_semester)} Year`
              : null,
            cls.departments.code,
            `Sec ${cls.section}`,
          ]
            .filter(Boolean)
            .join(' · ')
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }
  // The name line above already carries the humanized role — the email is
  // the useful second line here, not a repeat of the same word.
  return row.email;
}

/**
 * Shared shape for "give me a conversation plus enough of both participants'
 * profiles to render a ConversationSummary" — used by every read path that
 * needs one (getOrCreateConversation's existing-conversation fast path, its
 * race-recovery fallback, and toConversationSummary's by-id lookup) so none
 * of them have to fetch the row once just to know it exists and then fetch
 * it again in full a second time.
 */
const CONVERSATION_PARTICIPANTS_INCLUDE = {
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
                  current_semester: true,
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
} satisfies Prisma.message_conversationsInclude;

type ConversationWithParticipants = Prisma.message_conversationsGetPayload<{
  include: typeof CONVERSATION_PARTICIPANTS_INCLUDE;
}>;

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
    // Shared operational accounts (canteen_admin, canteen_cashier, ...)
    // aren't reachable through messaging at all, from any sender — not just
    // hidden from search (see searchPeople's WHERE clause), the same rule
    // closes the gap of messaging a known user id directly. Checked before
    // the student-only rule below since it applies regardless of the
    // sender's own role.
    if (MESSAGING_EXCLUDED_ROLES.includes(otherRoleName)) {
      throw new ForbiddenException({
        message: 'This account cannot be messaged.',
        errorCode: 'ACCOUNT_NOT_MESSAGEABLE',
      });
    }
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
   * a conversation already exists is still caught on the next send. Always
   * fetches the other party's role now (not just for a student sender) since
   * the canteen_admin rule above applies to every sender, not only students.
   */
  async assertCanMessage(
    senderRole: string,
    otherUserId: number,
  ): Promise<void> {
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

    // Each word must independently match first/last name (order-independent
    // — "Malar Sekar" and "Sekar Malar" both match first_name="Malar",
    // last_name="Sekar"); email is a single token, matched against the
    // whole raw query.
    const facultyNameWhere = buildMultiWordNameWhere(q, (word) => [
      { first_name: { contains: word, mode: 'insensitive' as const } },
      { last_name: { contains: word, mode: 'insensitive' as const } },
    ]);
    const studentNameWhere = buildMultiWordNameWhere(q, (word) => [
      { first_name: { contains: word, mode: 'insensitive' as const } },
      { last_name: { contains: word, mode: 'insensitive' as const } },
    ]);

    const rows = await this.prisma.users.findMany({
      where: {
        id: { not: callerUserId },
        status: 'active',
        // Shared operational accounts never appear in ANYONE's search
        // results — messaging is deliberately not part of their workflow at
        // all (see each role's own nav.ts on the frontend, which also
        // excludes the Messages nav item entirely for it). A student
        // additionally never sees another student — both rules live
        // directly in this WHERE, not filtered after the query runs.
        roles: {
          name: {
            notIn: [
              ...MESSAGING_EXCLUDED_ROLES,
              ...(callerRole === ROLES.STUDENT ? [ROLES.STUDENT] : []),
            ],
          },
        },
        OR: [
          ...(facultyNameWhere ? [{ faculty: facultyNameWhere }] : []),
          ...(studentNameWhere
            ? [{ students: { soa_applications: studentNameWhere } }]
            : []),
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
                current_semester: true,
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

    // Reopening a conversation you've messaged before is the overwhelmingly
    // common case (far more frequent than a genuine first contact) — fetch
    // full participant/profile detail directly in this one lookup instead of
    // a bare existence check followed by a second, separate query
    // re-fetching the exact same row (what this used to do), so the common
    // path is one round trip instead of two.
    const existing = await this.prisma.message_conversations.findUnique({
      where: { dm_key: dmKey },
      include: CONVERSATION_PARTICIPANTS_INCLUDE,
    });
    if (existing) return this.summarizeConversation(existing, callerUserId);

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
        include: CONVERSATION_PARTICIPANTS_INCLUDE,
      });
      return this.summarizeConversation(row, callerUserId);
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
                      current_semester: true,
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
      include: CONVERSATION_PARTICIPANTS_INCLUDE,
    });
    if (!conversation) return null;
    return this.summarizeConversation(conversation, callerUserId);
  }

  /**
   * Pure post-processing on an already-fetched row — split out of
   * toConversationSummary() so getOrCreateConversation's existing-conversation
   * path can reuse a row it already fetched with CONVERSATION_PARTICIPANTS_INCLUDE
   * instead of querying for the exact same conversation a second time.
   */
  private async summarizeConversation(
    conversation: ConversationWithParticipants,
    callerUserId: number,
  ) {
    const me = conversation.message_participants.find(
      (p) => p.user_id === callerUserId,
    );
    const otherParticipant = conversation.message_participants.find(
      (p) => p.user_id !== callerUserId,
    );
    if (!otherParticipant) return null;

    // A conversation with no last_message_id yet has zero messages, full
    // stop — no query needed to know its unread count is 0 or that it has
    // no last message to fetch. This is the exact, common shape of a
    // conversation opened straight from search results (created but never
    // sent into yet), so skipping both round trips here is what makes that
    // path fast instead of paying for a count() that could only ever be 0.
    if (!conversation.last_message_id) {
      return {
        id: Number(conversation.id),
        otherUser: {
          userId: otherParticipant.users.id,
          name: personDisplayName(otherParticipant.users),
          roleLabel: personRoleLabel(otherParticipant.users),
        },
        lastMessage: null,
        lastMessageAt: null,
        unreadCount: 0,
      };
    }

    const [lastMessage, unread] = await Promise.all([
      this.prisma.messages.findUnique({
        where: { id: conversation.last_message_id },
        select: {
          id: true,
          body: true,
          sender_user_id: true,
          created_at: true,
          is_deleted_for_everyone: true,
        },
      }),
      this.prisma.messages.count({
        where: {
          conversation_id: conversation.id,
          sender_user_id: { not: callerUserId },
          ...(me?.last_read_message_id
            ? { id: { gt: me.last_read_message_id } }
            : {}),
        },
      }),
    ]);

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
                roles: { select: { name: true } },
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
