import { Test, TestingModule } from '@nestjs/testing';
import { MeAlumniController } from './me-alumni.controller';
import { MeAlumniGroupService } from './me-alumni-group.service';
import { MeAlumniMessagesService } from './me-alumni-messages.service';
import { AlumniAnnouncementsService } from './alumni-announcements.service';

describe('MeAlumniController', () => {
  let controller: MeAlumniController;
  const groupService = { getOwnGroup: jest.fn(), updateOwnProfile: jest.fn() };
  const messagesService = {
    listMessages: jest.fn(),
    createMessage: jest.fn(),
    deleteMessage: jest.fn(),
  };
  const announcementsService = { listAnnouncements: jest.fn() };

  const user = { sub: 7, email: 'a@eos.test', role: 'alumni', roleId: 2 };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MeAlumniController],
      providers: [
        { provide: MeAlumniGroupService, useValue: groupService },
        { provide: MeAlumniMessagesService, useValue: messagesService },
        { provide: AlumniAnnouncementsService, useValue: announcementsService },
      ],
    }).compile();

    controller = module.get<MeAlumniController>(MeAlumniController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('resolves the caller from the JWT for every self-scoped route', () => {
    controller.getGroup(user);
    expect(groupService.getOwnGroup).toHaveBeenCalledWith(7);

    controller.updateProfile(user, { current_company: 'Acme' });
    expect(groupService.updateOwnProfile).toHaveBeenCalledWith(7, {
      current_company: 'Acme',
    });

    controller.deleteMessage(user, 99);
    expect(messagesService.deleteMessage).toHaveBeenCalledWith(7, 99);
  });
});
