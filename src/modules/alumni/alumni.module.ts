import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AlumniGraduationService } from './alumni-graduation.service';
import { AdminAlumniBatchesService } from './admin-alumni-batches.service';
import { AdminAlumniGroupsService } from './admin-alumni-groups.service';
import { MeAlumniGroupService } from './me-alumni-group.service';
import { MeAlumniMessagesService } from './me-alumni-messages.service';
import { AlumniAnnouncementsService } from './alumni-announcements.service';
import { AdminAlumniController } from './admin-alumni.controller';
import { MeAlumniController } from './me-alumni.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AdminAlumniController, MeAlumniController],
  providers: [
    AlumniGraduationService,
    AdminAlumniBatchesService,
    AdminAlumniGroupsService,
    MeAlumniGroupService,
    MeAlumniMessagesService,
    AlumniAnnouncementsService,
  ],
})
export class AlumniModule {}
