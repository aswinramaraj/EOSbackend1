import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { IqacStudentOdsService } from './iqac-student-ods.service';
import { IqacStudentOdsController } from './iqac-student-ods.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [IqacStudentOdsController],
  providers: [IqacStudentOdsService],
})
export class IqacStudentOdsModule {}
