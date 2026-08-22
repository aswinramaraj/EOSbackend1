import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AcademicCoordinatorResultsController } from './academic-coordinator-results.controller';
import { AcademicCoordinatorResultsService } from './academic-coordinator-results.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicCoordinatorResultsController],
  providers: [AcademicCoordinatorResultsService],
})
export class AcademicCoordinatorResultsModule {}
