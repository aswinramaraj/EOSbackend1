import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { ComplaintsService } from './complaints.service';
import { ComplaintsController } from './complaints.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}
