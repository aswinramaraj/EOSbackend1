jest.mock('../../../../generated/prisma/client', () => ({
  PrismaClient: class {},
  Prisma: {},
  announcement_status_enum: { draft: 'draft', published: 'published' },
  target_audience_enum: {
    students: 'students',
    teachers: 'teachers',
    parents: 'parents',
    roles: 'roles',
  },
}));
jest.mock('@prisma/adapter-pg', () => ({ PrismaPg: class {} }));

import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from 'src/prisma/prisma.service';
import { StorageService } from 'src/common/storage/storage.service';
import { NotificationsService } from 'src/modules/notifications/notifications/notifications.service';
import { ROLES } from 'src/common/constants/roles.constant';
import { AnnouncementsService } from './announcements.service';

describe('AnnouncementsService', () => {
  let service: AnnouncementsService;
  let notifications: { notify: jest.Mock };
  let tx: {
    announcements: { create: jest.Mock };
    announcement_class_mapping: { createMany: jest.Mock };
    announcement_role_mapping: { createMany: jest.Mock };
  };
  let prisma: {
    announcements: { create: jest.Mock };
    classes: { findMany: jest.Mock };
    departments: { findUnique: jest.Mock };
    roles: { findMany: jest.Mock };
    students: { findMany: jest.Mock };
    parent_student_mapping: { findMany: jest.Mock };
    faculty: { findMany: jest.Mock };
    users: { findMany: jest.Mock };
    $transaction: jest.Mock;
  };

  const adminUser = { sub: 1, role: ROLES.ADMIN, email: 'admin@sece.ac.in', roleId: 1 };

  beforeEach(async () => {
    tx = {
      announcements: { create: jest.fn() },
      announcement_class_mapping: { createMany: jest.fn() },
      announcement_role_mapping: { createMany: jest.fn() },
    };
    prisma = {
      announcements: { create: jest.fn() },
      classes: { findMany: jest.fn().mockResolvedValue([]) },
      departments: { findUnique: jest.fn() },
      roles: { findMany: jest.fn().mockResolvedValue([]) },
      students: { findMany: jest.fn().mockResolvedValue([]) },
      parent_student_mapping: { findMany: jest.fn().mockResolvedValue([]) },
      faculty: { findMany: jest.fn().mockResolvedValue([]) },
      users: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(tx)),
    };
    notifications = { notify: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnouncementsService,
        { provide: PrismaService, useValue: prisma },
        { provide: StorageService, useValue: { getPublicUrl: (k: string) => `https://cdn/${k}` } },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<AnnouncementsService>(AnnouncementsService);
  });

  describe('create - notification fan-out', () => {
    it("notifies every student in class_ids for target_audience 'students'", async () => {
      prisma.classes.findMany.mockResolvedValue([{ id: 10, department_id: 1 }]);
      tx.announcements.create.mockResolvedValue({ id: 900, title: 'Fest', status: 'published' });
      prisma.students.findMany.mockResolvedValue([{ user_id: 501 }, { user_id: 502 }]);

      await service.create(
        { title: 'Fest', content: 'Details', target_audience: 'students', class_ids: [10] } as any,
        adminUser as any,
      );

      expect(prisma.students.findMany).toHaveBeenCalledWith({
        where: { class_id: { in: [10] } },
        select: { user_id: true },
      });
      expect(notifications.notify).toHaveBeenCalledTimes(2);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 501,
          type: 'announcement_new',
          related_entity_type: 'announcement',
          related_entity_id: 900,
        }),
      );
    });

    it("notifies each distinct linked parent for target_audience 'parents'", async () => {
      prisma.classes.findMany.mockResolvedValue([{ id: 10, department_id: 1 }]);
      tx.announcements.create.mockResolvedValue({ id: 901, title: 'PTM', status: 'published' });
      prisma.parent_student_mapping.findMany.mockResolvedValue([
        { parent_user_id: 700 },
        { parent_user_id: 700 },
        { parent_user_id: 701 },
      ]);

      await service.create(
        { title: 'PTM', content: 'Details', target_audience: 'parents', class_ids: [10] } as any,
        adminUser as any,
      );

      expect(notifications.notify).toHaveBeenCalledTimes(2);
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 700, type: 'announcement_new', related_entity_id: 901 }),
      );
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 701, type: 'announcement_new', related_entity_id: 901 }),
      );
    });

    it("notifies only faculty in the target department for target_audience 'teachers' with department_id", async () => {
      prisma.departments.findUnique.mockResolvedValue({ id: 3, name: 'CSE' });
      prisma.announcements.create.mockResolvedValue({ id: 902, title: 'Dept meet', status: 'published' });
      prisma.faculty.findMany.mockResolvedValue([{ user_id: 800 }]);

      await service.create(
        { title: 'Dept meet', content: 'Details', target_audience: 'teachers', department_id: 3 } as any,
        adminUser as any,
      );

      expect(prisma.faculty.findMany).toHaveBeenCalledWith({
        where: { department_id: 3 },
        select: { user_id: true },
      });
      expect(notifications.notify).toHaveBeenCalledWith(
        expect.objectContaining({ user_id: 800, type: 'announcement_new', related_entity_id: 902 }),
      );
    });

    it("notifies every faculty account for an org-wide 'teachers' broadcast (no department_id)", async () => {
      prisma.announcements.create.mockResolvedValue({ id: 903, title: 'All staff', status: 'published' });
      prisma.faculty.findMany.mockResolvedValue([{ user_id: 800 }, { user_id: 801 }]);

      await service.create(
        { title: 'All staff', content: 'Details', target_audience: 'teachers' } as any,
        adminUser as any,
      );

      expect(prisma.faculty.findMany).toHaveBeenCalledWith({
        where: {},
        select: { user_id: true },
      });
      expect(notifications.notify).toHaveBeenCalledTimes(2);
    });

    it("notifies every user with a targeted role for target_audience 'roles'", async () => {
      prisma.roles.findMany.mockResolvedValueOnce([{ id: 5 }]); // assertRolesValid
      tx.announcements.create.mockResolvedValue({ id: 904, title: 'Library notice', status: 'published' });
      prisma.users.findMany.mockResolvedValue([{ id: 900 }, { id: 901 }]);

      await service.create(
        { title: 'Library notice', content: 'Details', target_audience: 'roles', role_ids: [5] } as any,
        adminUser as any,
      );

      expect(prisma.users.findMany).toHaveBeenCalledWith({
        where: { role_id: { in: [5] } },
        select: { id: true },
      });
      expect(notifications.notify).toHaveBeenCalledTimes(2);
    });

    it('sends no notifications for a draft, regardless of target_audience', async () => {
      tx.announcements.create.mockResolvedValue({ id: 905, title: 'Draft', status: 'draft' });

      await service.create(
        { title: 'Draft', content: 'Details', status: 'draft' } as any,
        adminUser as any,
      );

      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('does not fail announcement creation if resolving recipients throws', async () => {
      prisma.classes.findMany.mockResolvedValue([{ id: 10, department_id: 1 }]);
      tx.announcements.create.mockResolvedValue({ id: 906, title: 'Fest', status: 'published' });
      prisma.students.findMany.mockRejectedValue(new Error('connection lost'));

      const result = await service.create(
        { title: 'Fest', content: 'Details', target_audience: 'students', class_ids: [10] } as any,
        adminUser as any,
      );

      expect(result).toMatchObject({ id: 906 });
      expect(notifications.notify).not.toHaveBeenCalled();
    });
  });
});
