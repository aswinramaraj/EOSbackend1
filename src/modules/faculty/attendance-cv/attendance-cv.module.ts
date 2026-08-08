import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AttendanceCvService } from './attendance-cv.service';
import { AttendanceCvController } from './attendance-cv.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AttendanceCvController],
  providers: [AttendanceCvService],
})
export class AttendanceCvModule {}
