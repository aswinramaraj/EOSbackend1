import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodPlacementsService } from './hod-placements.service';
import { HodPlacementsController } from './hod-placements.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodPlacementsController],
  providers: [HodPlacementsService],
})
export class HodPlacementsModule {}
