import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { FeeStructureService } from './fee-structure.service';
import { FeeStructureController } from './fee-structure.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [FeeStructureController],
  providers: [FeeStructureService],
})
export class FeeStructureModule {}
