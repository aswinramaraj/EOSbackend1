import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { SmsModule } from 'src/common/sms/sms.module';
import { SoaApplicationsService } from './soa-applications.service';
import { SoaApplicationsController } from './soa-applications.controller';

@Module({
  imports: [PrismaModule, StorageModule, SmsModule],
  controllers: [SoaApplicationsController],
  providers: [SoaApplicationsService],
})
export class SoaApplicationsModule {}
