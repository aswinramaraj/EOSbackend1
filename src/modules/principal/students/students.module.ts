import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalDashboardModule } from '../dashboard/dashboard.module';
import { PrincipalStudentsController } from './students.controller';
import { PrincipalStudentsService } from './students.service';

@Module({
  imports: [PrismaModule, PrincipalDashboardModule],
  controllers: [PrincipalStudentsController],
  providers: [PrincipalStudentsService],
  exports: [PrincipalStudentsService],
})
export class PrincipalStudentsModule {}
