import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalDashboardModule } from '../dashboard/dashboard.module';
import { PrincipalFacultyController } from './faculty.controller';
import { PrincipalFacultyService } from './faculty.service';

@Module({
  imports: [PrismaModule, PrincipalDashboardModule],
  controllers: [PrincipalFacultyController],
  providers: [PrincipalFacultyService],
  exports: [PrincipalFacultyService],
})
export class PrincipalFacultyModule {}
