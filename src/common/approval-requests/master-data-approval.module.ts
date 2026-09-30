import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { DepartmentsModule } from 'src/modules/academic-structure/departments/departments.module';
import { CoursesModule } from 'src/modules/academic-structure/courses/courses.module';
import { BatchesModule } from 'src/modules/academic-structure/batches/batches.module';
import { ClassesModule } from 'src/modules/academic-structure/classes/classes.module';
import { AcademicCoordinatorMappingModule } from 'src/modules/academic-coordinator/mapping/academic-coordinator-mapping.module';
import { MasterDataApprovalService } from './master-data-approval.service';
import { MasterDataApprovalController } from './master-data-approval.controller';

@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    DepartmentsModule,
    CoursesModule,
    BatchesModule,
    ClassesModule,
    AcademicCoordinatorMappingModule,
  ],
  controllers: [MasterDataApprovalController],
  providers: [MasterDataApprovalService],
  exports: [MasterDataApprovalService],
})
export class MasterDataApprovalModule {}
