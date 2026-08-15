import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HostelAnnouncementsService } from './hostel-announcements.service';
import { HostelAnnouncementsController } from './hostel-announcements.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HostelAnnouncementsController],
  providers: [HostelAnnouncementsService],
})
export class HostelAnnouncementsModule {}
