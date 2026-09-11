import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { EResourcesService } from './e-resources.service';
import { EResourcesController } from './e-resources.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [EResourcesController],
  providers: [EResourcesService],
})
export class EResourcesModule {}
