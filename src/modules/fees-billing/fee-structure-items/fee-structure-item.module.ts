import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { FeeStructureItemService } from './fee-structure-item.service';
import { FeeStructureItemController } from './fee-structure-item.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [FeeStructureItemController],
  providers: [FeeStructureItemService],
})
export class FeeStructureItemModule {}
