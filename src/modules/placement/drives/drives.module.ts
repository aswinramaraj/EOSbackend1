import { Module } from '@nestjs/common';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CompaniesModule } from '../companies/companies.module';
import { DrivesService } from './drives.service';
import { DrivesController } from './drives.controller';
import { StudentDrivesController } from './student-drives.controller';
import { MeDrivesController } from './me-drives.controller';

@Module({
  imports: [PrismaModule, CompaniesModule],
  controllers: [DrivesController, StudentDrivesController, MeDrivesController],
  providers: [DrivesService],
  exports: [DrivesService],
})
export class DrivesModule {}
