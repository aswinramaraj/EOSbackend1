import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { GpaRecomputeService } from './gpa-recompute.service';

@Module({
  imports: [PrismaModule],
  providers: [GpaRecomputeService],
  exports: [GpaRecomputeService],
})
export class GpaRecomputeModule {}
