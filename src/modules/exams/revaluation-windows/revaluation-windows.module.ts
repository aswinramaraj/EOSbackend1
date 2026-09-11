import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';
import { RevaluationWindowsService } from './revaluation-windows.service';
import { RevaluationWindowsController } from './revaluation-windows.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [RevaluationWindowsController],
  providers: [RevaluationWindowsService],
})
export class RevaluationWindowsModule {}
