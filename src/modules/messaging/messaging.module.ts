import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { MessagingService } from './messaging.service';
import { MessageRequestsService } from './message-requests.service';
import { MessagingGateway } from './messaging.gateway';
import { MESSAGING_PUSHER } from './messaging-pusher.interface';
import { PresenceService } from './presence.service';
import { MessagingRateLimiterService } from './messaging-rate-limiter.service';
import { ConversationsController } from './conversations.controller';
import { MessagesController } from './messages.controller';
import { SearchController } from './search.controller';
import { MessageRequestsController } from './message-requests.controller';

@Module({
  imports: [PrismaModule, NotificationsModule, StorageModule],
  controllers: [
    ConversationsController,
    MessagesController,
    SearchController,
    MessageRequestsController,
  ],
  providers: [
    MessagingService,
    MessageRequestsService,
    MessagingGateway,
    { provide: MESSAGING_PUSHER, useExisting: MessagingGateway },
    PresenceService,
    MessagingRateLimiterService,
  ],
})
export class MessagingModule {}
