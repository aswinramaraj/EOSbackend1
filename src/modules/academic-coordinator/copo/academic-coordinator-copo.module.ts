import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AcademicCoordinatorCopoController } from './academic-coordinator-copo.controller';
import { AcademicCoordinatorCopoService } from './academic-coordinator-copo.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicCoordinatorCopoController],
  providers: [AcademicCoordinatorCopoService],
})
export class AcademicCoordinatorCopoModule {}
