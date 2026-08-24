import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/modules/storage/storage.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { AppraisalService } from './appraisal.service';
import { AppraisalController } from './appraisal.controller';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule],
  controllers: [AppraisalController],
  providers: [AppraisalService],
  exports: [AppraisalService],
})
export class AppraisalModule {}
