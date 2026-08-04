import { Module } from '@nestjs/common';
import { ExamTypesService } from './exam-types.service';
import { ExamTypesController } from './exam-types.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [ExamTypesController],
  providers: [ExamTypesService],
})
export class ExamTypesModule {}
