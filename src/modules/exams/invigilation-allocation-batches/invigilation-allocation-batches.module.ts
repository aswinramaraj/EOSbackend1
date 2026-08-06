import { Module } from '@nestjs/common';
import { InvigilationAllocationBatchesService } from './invigilation-allocation-batches.service';
import { InvigilationAllocationBatchesController } from './invigilation-allocation-batches.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [InvigilationAllocationBatchesController],
  providers: [InvigilationAllocationBatchesService],
})
export class InvigilationAllocationBatchesModule {}
