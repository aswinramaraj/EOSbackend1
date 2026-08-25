import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalDepartmentsModule } from 'src/modules/principal/departments/departments.module';
import { PrincipalExamsModule } from 'src/modules/principal/exams/exams.module';
import { ClassesModule } from 'src/modules/academic-structure/classes/classes.module';
import { CoursesModule } from 'src/modules/academic-structure/courses/courses.module';
import { IqacAcademicQualityController } from './iqac-academic-quality.controller';
import { IqacAcademicQualityService } from './iqac-academic-quality.service';

@Module({
  imports: [
    PrismaModule,
    PrincipalDepartmentsModule,
    PrincipalExamsModule,
    ClassesModule,
    CoursesModule,
  ],
  controllers: [IqacAcademicQualityController],
  providers: [IqacAcademicQualityService],
  exports: [IqacAcademicQualityService],
})
export class IqacAcademicQualityModule {}
