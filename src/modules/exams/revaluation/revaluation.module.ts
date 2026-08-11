// revaluation.module.ts
import { Module } from '@nestjs/common';
import { RevaluationService } from './revaluation.service';
import { RevaluationController } from './revaluation.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [RevaluationController],
  providers: [RevaluationService],
})
export class RevaluationModule {}
