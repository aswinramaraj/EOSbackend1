import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { NotificationsModule } from '../../notifications/notifications/notifications.module';
import { StudentsService } from './students.service';
import { StudentIdCardService } from './student-id-card.service';
import { StudentsController } from './students.controller';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule],
  controllers: [StudentsController],
  providers: [StudentsService, StudentIdCardService],
})
export class StudentsModule {}
