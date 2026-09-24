import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SubjectRecordsModule } from 'src/modules/faculty/subject-records/subject-records.module';
import { NoDueModule } from 'src/modules/faculty/no-due/no-due.module';
import { SubjectNoDueModule } from 'src/modules/faculty/subject-no-due/subject-no-due.module';
import { StudentHigherEducationModule } from 'src/modules/student-higher-education/student-higher-education.module';
import { StudentEntrepreneurshipModule } from 'src/modules/student-entrepreneurship/student-entrepreneurship.module';
import { ClassMentorsService } from './class-mentors.service';
import { ClassMentorsController } from './class-mentors.controller';

@Module({
  imports: [
    PrismaModule,
    SubjectRecordsModule,
    NoDueModule,
    SubjectNoDueModule,
    StudentHigherEducationModule,
    StudentEntrepreneurshipModule,
  ],
  controllers: [ClassMentorsController],
  providers: [ClassMentorsService],
})
export class ClassMentorsModule {}
