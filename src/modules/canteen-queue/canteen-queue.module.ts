import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CanteenQueueController } from './canteen-queue.controller';
import { CanteenQueueService } from './canteen-queue.service';
import { CanteenQueueGateway } from './canteen-queue.gateway';
import { CanteenQueuePushService } from './canteen-queue-push.service';

@Module({
  imports: [PrismaModule],
  controllers: [CanteenQueueController],
  providers: [
    CanteenQueueService,
    CanteenQueueGateway,
    CanteenQueuePushService,
  ],
  exports: [CanteenQueuePushService],
})
export class CanteenQueueModule {}
