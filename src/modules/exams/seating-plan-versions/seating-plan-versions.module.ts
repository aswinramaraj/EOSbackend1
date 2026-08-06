import { Module } from '@nestjs/common';
import { SeatingPlanVersionsService } from './seating-plan-versions.service';
import { SeatingPlanVersionsController } from './seating-plan-versions.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SeatingPlanVersionsController],
  providers: [SeatingPlanVersionsService],
})
export class SeatingPlanVersionsModule {}
