import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { PushNotificationService } from './push-notification.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushNotificationService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
