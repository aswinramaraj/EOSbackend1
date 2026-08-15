import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { MeNotificationsController } from './me-notifications.controller';
import { NotificationsController } from './notifications.controller';
import { PushNotificationService } from './push-notification.service';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MeNotificationsController, NotificationsController],
  providers: [NotificationsService, PushNotificationService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
