import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StationaryService } from './stationary.service';
import { StationaryController } from './stationary.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StationaryController],
  providers: [StationaryService],
})
export class StationaryModule {}
