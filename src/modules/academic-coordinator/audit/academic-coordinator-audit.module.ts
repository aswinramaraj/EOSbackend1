import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AcademicCoordinatorAuditController } from './academic-coordinator-audit.controller';
import { AcademicCoordinatorAuditService } from './academic-coordinator-audit.service';

@Module({
  imports: [PrismaModule],
  controllers: [AcademicCoordinatorAuditController],
  providers: [AcademicCoordinatorAuditService],
})
export class AcademicCoordinatorAuditModule {}
