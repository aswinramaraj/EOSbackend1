import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalPlacementsModule } from 'src/modules/principal/placements/placements.module';
import { AchievementsModule } from 'src/modules/sports-admin/achievements/achievements.module';
import { DrivesModule } from 'src/modules/placement/drives/drives.module';
import { IqacStudentDevelopmentController } from './iqac-student-development.controller';
import { IqacStudentDevelopmentService } from './iqac-student-development.service';

@Module({
  imports: [
    PrismaModule,
    PrincipalPlacementsModule,
    AchievementsModule,
    DrivesModule,
  ],
  controllers: [IqacStudentDevelopmentController],
  providers: [IqacStudentDevelopmentService],
  exports: [IqacStudentDevelopmentService],
})
export class IqacStudentDevelopmentModule {}
