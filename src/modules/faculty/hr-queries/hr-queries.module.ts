import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { HrQueriesService } from './hr-queries.service';
import { HrQueriesController } from './hr-queries.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [HrQueriesController],
  providers: [HrQueriesService],
  exports: [HrQueriesService],
})
export class HrQueriesModule {}
