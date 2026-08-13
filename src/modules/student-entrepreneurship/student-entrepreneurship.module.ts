import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentEntrepreneurshipController, MeMenteeEntrepreneurshipController, MeEdcEntrepreneurshipController } from './student-entrepreneurship.controller';
import { StudentEntrepreneurshipService } from './student-entrepreneurship.service';

@Module({
  imports: [PrismaModule],
  controllers: [StudentEntrepreneurshipController, MeMenteeEntrepreneurshipController, MeEdcEntrepreneurshipController],
  providers: [StudentEntrepreneurshipService],
})
export class StudentEntrepreneurshipModule {}
