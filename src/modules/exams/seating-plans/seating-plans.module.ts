import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SeatingPlansService } from './seating-plans.service';
import { SeatingPlansController } from './seating-plans.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SeatingPlansController],
  providers: [SeatingPlansService],
})
export class SeatingPlansModule {}
