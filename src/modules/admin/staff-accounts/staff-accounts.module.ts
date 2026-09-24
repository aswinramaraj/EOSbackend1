import { Module } from '@nestjs/common';
import { StaffAccountsService } from './staff-accounts.service';
import { StaffAccountsController } from './staff-accounts.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [StaffAccountsController],
  providers: [StaffAccountsService],
})
export class StaffAccountsModule {}
