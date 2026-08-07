import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SubjectRecordsService } from './subject-records.service';
import { SubjectRecordsController } from './subject-records.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SubjectRecordsController],
  providers: [SubjectRecordsService],
})
export class SubjectRecordsModule {}
