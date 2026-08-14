import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { StudentOdsService } from './student-ods.service';
import { StudentOdsController } from './student-ods.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [StudentOdsController],
  providers: [StudentOdsService],
})
export class StudentOdsModule {}
