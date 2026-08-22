import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalFacultyModule } from 'src/modules/principal/faculty/faculty.module';
import { AcademicCoordinatorFacultyController } from './academic-coordinator-faculty.controller';
import { AcademicCoordinatorFacultyService } from './academic-coordinator-faculty.service';

@Module({
  imports: [PrismaModule, PrincipalFacultyModule],
  controllers: [AcademicCoordinatorFacultyController],
  providers: [AcademicCoordinatorFacultyService],
})
export class AcademicCoordinatorFacultyModule {}
