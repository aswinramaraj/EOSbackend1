import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodClassRecordsService } from './hod-class-records.service';
import { HodClassRecordsController } from './hod-class-records.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodClassRecordsController],
  providers: [HodClassRecordsService],
})
export class HodClassRecordsModule {}
