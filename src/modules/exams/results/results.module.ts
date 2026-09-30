// results.module.ts
import { Module } from '@nestjs/common';
import { ResultsService } from './results.service';
import { ResultsController } from './results.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { GpaRecomputeModule } from '../gpa/gpa-recompute.module';

@Module({
  imports: [PrismaModule, AuditLogModule, NotificationsModule, GpaRecomputeModule],
  controllers: [ResultsController],
  providers: [ResultsService],
})
export class ResultsModule {}
