import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CoachesService } from './coaches.service';
import { CoachesController } from './coaches.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CoachesController],
  providers: [CoachesService],
  exports: [CoachesService],
})
export class CoachesModule {}
