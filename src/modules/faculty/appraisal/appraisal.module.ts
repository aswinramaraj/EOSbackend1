import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/modules/storage/storage.module';
import { AppraisalService } from './appraisal.service';
import { AppraisalController } from './appraisal.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [AppraisalController],
  providers: [AppraisalService],
  exports: [AppraisalService],
})
export class AppraisalModule {}
