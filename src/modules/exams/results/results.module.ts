// results.module.ts
import { Module } from '@nestjs/common';
import { ResultsService } from './results.service';
import { ResultsController } from './results.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
