import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentOdsService } from './student-ods.service';
import { StudentOdsController } from './student-ods.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StudentOdsController],
  providers: [StudentOdsService],
})
export class StudentOdsModule {}
