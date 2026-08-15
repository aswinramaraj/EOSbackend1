import { Test, TestingModule } from '@nestjs/testing';
import { AdminAlumniController } from './admin-alumni.controller';
import { AlumniGraduationService } from './alumni-graduation.service';
import { AdminAlumniBatchesService } from './admin-alumni-batches.service';
import { AdminAlumniGroupsService } from './admin-alumni-groups.service';
import { AlumniAnnouncementsService } from './alumni-announcements.service';

describe('AdminAlumniController', () => {
  let controller: AdminAlumniController;
  const graduationService = { graduateBatch: jest.fn() };
  const batchesService = { listBatches: jest.fn() };
  const groupsService = {
    getGroupDetail: jest.fn(),
    listTimeline: jest.fn(),
    createMessageForBatch: jest.fn(),
  };
  const announcementsService = { createAnnouncement: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAlumniController],
      providers: [
        { provide: AlumniGraduationService, useValue: graduationService },
        { provide: AdminAlumniBatchesService, useValue: batchesService },
        { provide: AdminAlumniGroupsService, useValue: groupsService },
        { provide: AlumniAnnouncementsService, useValue: announcementsService },
      ],
    }).compile();

    controller = module.get<AdminAlumniController>(AdminAlumniController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates graduateBatch to the graduation service', () => {
    controller.graduateBatch(7);
    expect(graduationService.graduateBatch).toHaveBeenCalledWith(7);
  });

  it('delegates createAnnouncement with the caller resolved from the JWT', () => {
    controller.createAnnouncement(
      { sub: 42, email: 'a@eos.test', role: 'admin', roleId: 1 },
      { title: 'Reunion', content: 'Details' },
    );
    expect(announcementsService.createAnnouncement).toHaveBeenCalledWith(42, {
      title: 'Reunion',
      content: 'Details',
    });
  });

  it('delegates getGroupDetail to the groups service', () => {
    controller.getGroupDetail(5);
    expect(groupsService.getGroupDetail).toHaveBeenCalledWith(5);
  });

  it('delegates getTimeline to the groups service', () => {
    controller.getTimeline(5);
    expect(groupsService.listTimeline).toHaveBeenCalledWith(5);
  });

  it('delegates postMessage with the caller resolved from the JWT, not client-supplied', () => {
    controller.postMessage(
      5,
      { content: 'Welcome, everyone!' },
      { sub: 42, email: 'principal@eos.test', role: 'principal', roleId: 3 },
    );
    expect(groupsService.createMessageForBatch).toHaveBeenCalledWith(42, 5, {
      content: 'Welcome, everyone!',
    });
  });
});
