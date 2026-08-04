// revaluation.module.ts
import { Module } from '@nestjs/common';
import { RevaluationService } from './revaluation.service';
import { RevaluationController } from './revaluation.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RevaluationController],
  providers: [RevaluationService],
})
export class RevaluationModule {}
