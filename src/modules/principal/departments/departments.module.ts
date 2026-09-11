import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from 'src/common/audit-log/audit-log.module';
import { PrincipalDepartmentsController } from './departments.controller';
import { PrincipalDepartmentsService } from './departments.service';

@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [PrincipalDepartmentsController],
  providers: [PrincipalDepartmentsService],
  exports: [PrincipalDepartmentsService],
})
export class PrincipalDepartmentsModule {}
