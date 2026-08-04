import { Module } from '@nestjs/common';
import { SeatingArrangementsService } from './seating-arrangements.service';
import { SeatingArrangementsController } from './seating-arrangements.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [SeatingArrangementsController],
  providers: [SeatingArrangementsService],
})
export class SeatingArrangementsModule {}
