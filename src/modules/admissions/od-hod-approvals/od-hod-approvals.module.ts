import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { OdHodApprovalsService } from './od-hod-approvals.service';
import { OdHodApprovalsController } from './od-hod-approvals.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [OdHodApprovalsController],
  providers: [OdHodApprovalsService],
})
export class OdHodApprovalsModule {}
