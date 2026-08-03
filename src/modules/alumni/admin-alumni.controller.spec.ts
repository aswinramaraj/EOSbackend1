import { Test, TestingModule } from '@nestjs/testing';
import { AdminAlumniController } from './admin-alumni.controller';
import { AlumniGraduationService } from './alumni-graduation.service';
import { AdminAlumniBatchesService } from './admin-alumni-batches.service';
import { AlumniAnnouncementsService } from './alumni-announcements.service';

describe('AdminAlumniController', () => {
  let controller: AdminAlumniController;
  const graduationService = { graduateBatch: jest.fn() };
  const batchesService = { listBatches: jest.fn() };
  const announcementsService = { createAnnouncement: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdminAlumniController],
      providers: [
        { provide: AlumniGraduationService, useValue: graduationService },
        { provide: AdminAlumniBatchesService, useValue: batchesService },
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
});
