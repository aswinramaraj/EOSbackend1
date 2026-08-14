import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FitnessService } from './fitness.service';
import { FitnessController } from './fitness.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FitnessController],
  providers: [FitnessService],
  exports: [FitnessService],
})
export class FitnessModule {}
