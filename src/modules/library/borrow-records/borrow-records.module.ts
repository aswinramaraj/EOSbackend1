import { Module } from '@nestjs/common';
import { BorrowRecordsController } from './borrow-records.controller';
import { BorrowRecordsService } from './borrow-records.service';
import { PrismaModule } from '../../../prisma/prisma.module';
import { LibrarySettingsModule } from '../settings/settings.module';
import { NotificationsModule } from '../../notifications/notifications/notifications.module';

@Module({
  imports: [PrismaModule, LibrarySettingsModule, NotificationsModule],
  controllers: [BorrowRecordsController],
  providers: [BorrowRecordsService],
  exports: [BorrowRecordsService],
})
export class BorrowRecordsModule {}
