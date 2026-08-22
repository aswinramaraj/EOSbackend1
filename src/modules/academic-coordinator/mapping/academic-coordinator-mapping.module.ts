import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AcademicCoordinatorMappingController } from './academic-coordinator-mapping.controller';
import { AcademicCoordinatorMappingService } from './academic-coordinator-mapping.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicCoordinatorMappingController],
  providers: [AcademicCoordinatorMappingService],
})
export class AcademicCoordinatorMappingModule {}
