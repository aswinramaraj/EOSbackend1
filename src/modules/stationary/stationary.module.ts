import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { StationaryService } from './stationary.service';
import { StationaryController } from './stationary.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [StationaryController],
  providers: [StationaryService],
})
export class StationaryModule {}
