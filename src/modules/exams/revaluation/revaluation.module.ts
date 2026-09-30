// revaluation.module.ts
import { Module } from '@nestjs/common';
import { RevaluationService } from './revaluation.service';
import { RevaluationController } from './revaluation.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';
import { GpaRecomputeModule } from '../gpa/gpa-recompute.module';

@Module({
  imports: [PrismaModule, NotificationsModule, AuditLogModule, GpaRecomputeModule],
  controllers: [RevaluationController],
  providers: [RevaluationService],
})
export class RevaluationModule {}
