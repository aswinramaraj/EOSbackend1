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
  // Exported so BorrowRequestsModule can reuse create() end-to-end for its
  // "accept" step instead of duplicating any of its borrow-side checks.
  exports: [BorrowRecordsService],
})
export class BorrowRecordsModule {}
