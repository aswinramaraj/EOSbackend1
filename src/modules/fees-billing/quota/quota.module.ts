import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { QuotaService } from './quota.service';
import { QuotaController } from './quota.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [QuotaController],
  providers: [QuotaService],
})
export class QuotaModule {}
