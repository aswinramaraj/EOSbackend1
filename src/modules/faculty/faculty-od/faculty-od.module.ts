import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/modules/storage/storage.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { FacultyOdService } from './faculty-od.service';
import { FacultyOdController } from './faculty-od.controller';

@Module({
  imports: [PrismaModule, StorageModule, NotificationsModule],
  controllers: [FacultyOdController],
  providers: [FacultyOdService],
  exports: [FacultyOdService],
})
export class FacultyOdModule {}
