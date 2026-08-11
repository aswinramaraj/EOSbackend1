import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { FacultyLeavesService } from './faculty-leaves.service';
import { FacultyLeavesController } from './faculty-leaves.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [FacultyLeavesController],
  providers: [FacultyLeavesService],
})
export class FacultyLeavesModule {}
