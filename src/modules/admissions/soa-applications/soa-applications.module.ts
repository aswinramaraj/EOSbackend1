import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { SmsModule } from 'src/common/sms/sms.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';
import { SoaApplicationsService } from './soa-applications.service';
import { SoaApplicationsController } from './soa-applications.controller';

@Module({
  imports: [PrismaModule, StorageModule, SmsModule, AuditLogModule],
  controllers: [SoaApplicationsController],
  providers: [SoaApplicationsService],
})
export class SoaApplicationsModule {}
