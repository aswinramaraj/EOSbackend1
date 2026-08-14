import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentEntrepreneurshipController } from './student-entrepreneurship.controller';
import { StudentEntrepreneurshipService } from './student-entrepreneurship.service';

@Module({
  imports: [PrismaModule],
  controllers: [StudentEntrepreneurshipController],
  providers: [StudentEntrepreneurshipService],
})
export class StudentEntrepreneurshipModule {}
