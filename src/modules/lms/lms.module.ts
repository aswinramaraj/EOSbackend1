import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { LmsService } from './lms.service';
import { LmsController } from './lms.controller';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule],
  controllers: [LmsController],
  providers: [LmsService],
})
export class LmsModule {}
