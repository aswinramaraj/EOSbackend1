import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';
import { ParentAccountsService } from './parent-accounts.service';
import { ParentAccountsController } from './parent-accounts.controller';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [ParentAccountsController],
  providers: [ParentAccountsService],
})
export class ParentAccountsModule {}
