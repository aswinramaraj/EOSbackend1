import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentHigherEducationController, MeMenteeHigherEducationController } from './student-higher-education.controller';
import { StudentHigherEducationService } from './student-higher-education.service';

@Module({
  imports: [PrismaModule],
  controllers: [StudentHigherEducationController, MeMenteeHigherEducationController],
  providers: [StudentHigherEducationService],
})
export class StudentHigherEducationModule {}
