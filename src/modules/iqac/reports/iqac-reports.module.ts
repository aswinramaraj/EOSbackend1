import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { IqacAcademicQualityModule } from 'src/modules/iqac/academic-quality/iqac-academic-quality.module';
import { IqacStudentDevelopmentModule } from 'src/modules/iqac/student-development/iqac-student-development.module';
import { IqacFacultyDevelopmentModule } from 'src/modules/iqac/faculty-development/iqac-faculty-development.module';
import { AccreditationModule } from 'src/modules/secretary-portal/accreditation/accreditation.module';
import { IqacAccreditationModule } from 'src/modules/iqac/accreditation/iqac-accreditation.module';
import { IqacReportsService } from './iqac-reports.service';
import { IqacReportsController } from './iqac-reports.controller';

@Module({
  imports: [
    PrismaModule,
    IqacAcademicQualityModule,
    IqacStudentDevelopmentModule,
    IqacFacultyDevelopmentModule,
    AccreditationModule,
    IqacAccreditationModule,
  ],
  controllers: [IqacReportsController],
  providers: [IqacReportsService],
})
export class IqacReportsModule {}
