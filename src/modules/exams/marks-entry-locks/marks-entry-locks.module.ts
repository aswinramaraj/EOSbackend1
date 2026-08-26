import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';
import { MarksEntryLocksService } from './marks-entry-locks.service';
import { MarksEntryLocksController } from './marks-entry-locks.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [MarksEntryLocksController],
  providers: [MarksEntryLocksService],
})
export class MarksEntryLocksModule {}
