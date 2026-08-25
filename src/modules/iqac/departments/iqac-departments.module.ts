import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalDepartmentsModule } from 'src/modules/principal/departments/departments.module';
import { IqacDepartmentsController } from './iqac-departments.controller';
import { IqacDepartmentsService } from './iqac-departments.service';

@Module({
  imports: [PrismaModule, PrincipalDepartmentsModule],
  controllers: [IqacDepartmentsController],
  providers: [IqacDepartmentsService],
})
export class IqacDepartmentsModule {}
