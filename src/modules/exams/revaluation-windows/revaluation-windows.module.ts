import { Module } from '@nestjs/common';
import { RevaluationWindowsService } from './revaluation-windows.service';
import { RevaluationWindowsController } from './revaluation-windows.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RevaluationWindowsController],
  providers: [RevaluationWindowsService],
})
export class RevaluationWindowsModule {}
