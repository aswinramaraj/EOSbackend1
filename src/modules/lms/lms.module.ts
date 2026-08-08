import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { LmsService } from './lms.service';
import { LmsController } from './lms.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [LmsController],
  providers: [LmsService],
})
export class LmsModule {}
