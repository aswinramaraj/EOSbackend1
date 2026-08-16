import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { IncubationsController } from './incubations.controller';
import { IncubationsService } from './incubations.service';

@Module({
  imports: [PrismaModule],
  controllers: [IncubationsController],
  providers: [IncubationsService],
})
export class IncubationsModule {}
