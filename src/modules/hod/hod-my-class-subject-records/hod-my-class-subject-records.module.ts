import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodMyClassSubjectRecordsService } from './hod-my-class-subject-records.service';
import { HodMyClassSubjectRecordsController } from './hod-my-class-subject-records.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodMyClassSubjectRecordsController],
  providers: [HodMyClassSubjectRecordsService],
})
export class HodMyClassSubjectRecordsModule {}
