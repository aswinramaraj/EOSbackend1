import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentExamRecordService } from './student-exam-record.service';
import { StudentExamRecordController } from './student-exam-record.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StudentExamRecordController],
  providers: [StudentExamRecordService],
})
export class StudentExamRecordModule {}
