import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { MessagingService } from './messaging.service';
import { MessagingGateway } from './messaging.gateway';
import { MESSAGING_PUSHER } from './messaging-pusher.interface';
import { PresenceService } from './presence.service';
import { MessagingRateLimiterService } from './messaging-rate-limiter.service';
import { ConversationsController } from './conversations.controller';
import { MessagesController } from './messages.controller';
import { SearchController } from './search.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ConversationsController, MessagesController, SearchController],
  providers: [
    MessagingService,
    MessagingGateway,
    { provide: MESSAGING_PUSHER, useExisting: MessagingGateway },
    PresenceService,
    MessagingRateLimiterService,
  ],
})
export class MessagingModule {}
