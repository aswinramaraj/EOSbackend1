import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { EducationLoanDdService } from './education-loan-dd.service';
import { EducationLoanDdController } from './education-loan-dd.controller';

@Module({
  imports: [PrismaModule, AuditLogModule, NotificationsModule],
  controllers: [EducationLoanDdController],
  providers: [EducationLoanDdService],
})
export class EducationLoanDdModule {}
