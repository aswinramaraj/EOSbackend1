import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from '../../notifications/notifications/notifications.module';
import { FacultyService } from './faculty.service';
import { FacultyController } from './faculty.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [FacultyController],
  providers: [FacultyService],
})
export class FacultyModule {}
