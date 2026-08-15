import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TrialsService } from './trials.service';
import { TrialsController } from './trials.controller';

@Module({
  imports: [PrismaModule],
  controllers: [TrialsController],
  providers: [TrialsService],
  exports: [TrialsService],
})
export class TrialsModule {}
