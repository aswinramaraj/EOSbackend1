jest.mock('../../../generated/prisma/client', () => ({
  PrismaClient: class {},
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { MessagingService } from './messaging.service';
import { MESSAGING_PUSHER } from './messaging-pusher.interface';
import { PresenceService } from './presence.service';

describe('MessagingService', () => {
  let service: MessagingService;
  let prisma: {
    message_conversations: {
      findUnique: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
    users: { findUnique: jest.Mock; findMany: jest.Mock };
    messages: { findUnique: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  // Bare-minimum "no personal profile" user row (roles.name only, no
  // faculty/students) — the simplest shape personDisplayName/personRoleLabel
  // can render, so these tests can focus purely on the query-count/skip
  // behavior under test, not on name/label formatting (already covered live).
  function fakeUserRow(id: number, roleName: string) {
    return {
      id,
      email: `user${id}@sece.ac.in`,
      roles: { name: roleName },
      faculty: null,
      students: null,
    };
  }

  beforeEach(async () => {
    prisma = {
      message_conversations: {
        findUnique: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      users: { findUnique: jest.fn(), findMany: jest.fn() },
      messages: { findUnique: jest.fn(), count: jest.fn() },
      $transaction: jest.fn(),
    };
    // assertCanMessage now always looks up the other party's role (see its
    // own doc comment — needed so the canteen_admin-not-messageable rule
    // applies regardless of the sender's role, not just for a student
    // sender). Defaulted here to a harmless role so every test below is
    // exercising the getOrCreateConversation behavior under test, not this
    // unrelated precondition.
    prisma.users.findUnique.mockResolvedValue({
      roles: { name: ROLES.FACULTY },
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessagingService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: NotificationsService,
          useValue: { notify: jest.fn() },
        },
        { provide: PresenceService, useValue: { isOnline: jest.fn() } },
        { provide: MESSAGING_PUSHER, useValue: { pushToUser: jest.fn() } },
      ],
    }).compile();

    service = module.get<MessagingService>(MessagingService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getOrCreateConversation — existing conversation', () => {
    // Regression coverage for the round-trip fix: this used to do a bare
    // existence-check findUnique (no include) and then, on a hit, a SECOND
    // findUnique-by-id (via toConversationSummary) to fetch the same row's
    // full detail — two round trips for what is by far the most common case
    // (reopening a conversation you've already messaged before). It now
    // fetches full detail in the one existence-check query and reuses it
    // directly, so this must resolve with exactly ONE
    // message_conversations.findUnique call, not two.
    it('fetches the conversation row exactly once, not twice', async () => {
      prisma.message_conversations.findUnique.mockResolvedValue({
        id: 42n,
        last_message_id: null,
        last_message_at: null,
        message_participants: [
          { user_id: 1, users: fakeUserRow(1, ROLES.HOD) },
          { user_id: 2, users: fakeUserRow(2, ROLES.FACULTY) },
        ],
      });

      const result = await service.getOrCreateConversation(1, ROLES.HOD, 2);

      expect(prisma.message_conversations.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        id: 42,
        otherUser: { userId: 2 },
        lastMessage: null,
        unreadCount: 0,
      });
    });
  });

  describe('summarizeConversation — message-less conversation', () => {
    // Regression coverage: a conversation with no last_message_id yet
    // (created but never sent into — exactly the state search-then-click
    // leaves it in) has zero messages by definition. Fetching a last
    // message and counting unread messages for it can only ever produce
    // null/0 — this must skip both queries entirely, not spend two round
    // trips confirming a foregone conclusion.
    it('skips the last-message and unread-count queries entirely', async () => {
      prisma.message_conversations.findUnique.mockResolvedValue({
        id: 7n,
        last_message_id: null,
        last_message_at: null,
        message_participants: [
          { user_id: 10, users: fakeUserRow(10, ROLES.HOD) },
          { user_id: 20, users: fakeUserRow(20, ROLES.STUDENT) },
        ],
      });

      const result = await service.getOrCreateConversation(10, ROLES.HOD, 20);

      expect(prisma.messages.findUnique).not.toHaveBeenCalled();
      expect(prisma.messages.count).not.toHaveBeenCalled();
      expect(result).toMatchObject({
        lastMessage: null,
        lastMessageAt: null,
        unreadCount: 0,
      });
    });

    // Same row, but WITH a last message — the two queries above must still
    // run in this case, proving the skip above is conditional on
    // last_message_id being null, not a blanket removal of the checks.
    it('still fetches last message and unread count when one exists', async () => {
      prisma.message_conversations.findUnique.mockResolvedValue({
        id: 8n,
        last_message_id: 500n,
        last_message_at: new Date('2026-09-15T10:00:00Z'),
        message_participants: [
          { user_id: 10, users: fakeUserRow(10, ROLES.HOD) },
          { user_id: 20, users: fakeUserRow(20, ROLES.STUDENT) },
        ],
      });
      prisma.messages.findUnique.mockResolvedValue({
        id: 500n,
        body: 'hello',
        sender_user_id: 20,
        created_at: new Date('2026-09-15T10:00:00Z'),
        is_deleted_for_everyone: false,
      });
      prisma.messages.count.mockResolvedValue(3);

      const result = await service.getOrCreateConversation(10, ROLES.HOD, 20);

      expect(prisma.messages.findUnique).toHaveBeenCalledTimes(1);
      expect(prisma.messages.count).toHaveBeenCalledTimes(1);
      expect(result).toMatchObject({
        lastMessage: { id: 500, body: 'hello' },
        unreadCount: 3,
      });
    });
  });

  describe.each([
    ['canteen_admin', ROLES.CANTEEN_ADMIN],
    ['canteen_cashier', ROLES.CANTEEN_CASHIER],
  ])('%s is not messageable', (_label, excludedRole) => {
    // Regression coverage: each shared operational account must be
    // unreachable through messaging from ANY sender role, not just students
    // — a separate rule from the student-to-student block, and must not
    // silently rely on the sender being a student (assertCanMessage used to
    // skip its DB check entirely for a non-student sender, which would have
    // let this rule through unenforced for e.g. an HOD sender).
    it(`blocks getOrCreateConversation when the target is ${excludedRole}, even for a non-student sender`, async () => {
      prisma.users.findUnique.mockResolvedValue({
        roles: { name: excludedRole },
      });

      await expect(
        service.getOrCreateConversation(1, ROLES.HOD, 2),
      ).rejects.toThrow('This account cannot be messaged.');

      // Must be rejected before ever touching the conversation table.
      expect(prisma.message_conversations.findUnique).not.toHaveBeenCalled();
    });

    it(`excludes ${excludedRole} from every caller's searchPeople results, not just a student caller`, async () => {
      prisma.users.findMany.mockResolvedValue([]);

      await service.searchPeople(1, ROLES.HOD, { q: 'anything' });

      const call = prisma.users.findMany.mock.calls[0] as [
        { where: { roles: { name: { notIn: string[] } } } },
      ];
      expect(call[0].where.roles.name.notIn).toContain(excludedRole);
    });
  });
});
