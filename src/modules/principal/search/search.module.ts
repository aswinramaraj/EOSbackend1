import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalStudentsModule } from '../students/students.module';
import { PrincipalFacultyModule } from '../faculty/faculty.module';
import { PrincipalApprovalsModule } from '../approvals/approvals.module';
import { AnnouncementsModule } from 'src/modules/announcements/announcements/announcements.module';
import { PrincipalSearchController } from './search.controller';
import { PrincipalSearchService } from './search.service';

@Module({
  imports: [
    PrismaModule,
    PrincipalStudentsModule,
    PrincipalFacultyModule,
    PrincipalApprovalsModule,
    AnnouncementsModule,
  ],
  controllers: [PrincipalSearchController],
  providers: [PrincipalSearchService],
})
export class PrincipalSearchModule {}
