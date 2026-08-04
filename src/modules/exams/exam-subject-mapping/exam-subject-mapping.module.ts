import { Module } from '@nestjs/common';
import { ExamSubjectMappingController } from './exam-subject-mapping.controller';
import { ExamSubjectMappingService } from './exam-subject-mapping.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [ExamSubjectMappingController],
  providers: [ExamSubjectMappingService, PrismaService],
})
export class ExamSubjectMappingModule {}
