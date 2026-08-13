import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentEntrepreneurshipController, MeMenteeEntrepreneurshipController } from './student-entrepreneurship.controller';
import { StudentEntrepreneurshipService } from './student-entrepreneurship.service';

@Module({
  imports: [PrismaModule],
  controllers: [StudentEntrepreneurshipController, MeMenteeEntrepreneurshipController],
  providers: [StudentEntrepreneurshipService],
})
export class StudentEntrepreneurshipModule {}
