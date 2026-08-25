import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { AuditLogModule } from 'src/modules/fees-billing/audit-log/audit-log.module';
import { AnnouncementsService } from './announcements.service';
import { AnnouncementsController } from './announcements.controller';
import { AnnouncementCommentsController } from './announcement-comments.controller';
import { AnnouncementCommentsService } from './announcement-comments.service';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule, AuditLogModule],
  controllers: [AnnouncementsController, AnnouncementCommentsController],
  providers: [AnnouncementsService, AnnouncementCommentsService],
  exports: [AnnouncementsService],
})
export class AnnouncementsModule {}
