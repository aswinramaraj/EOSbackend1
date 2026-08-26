import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';
import { MalpracticeService } from './malpractice.service';
import { MalpracticeController } from './malpractice.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [MalpracticeController],
  providers: [MalpracticeService],
})
export class MalpracticeModule {}
