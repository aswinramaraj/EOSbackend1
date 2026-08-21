import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { FeeConcessionService } from './fee-concession.service';
import { FeeConcessionController } from './fee-concession.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [FeeConcessionController],
  providers: [FeeConcessionService],
})
export class FeeConcessionModule {}
