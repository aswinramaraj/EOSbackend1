import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalDepartmentsModule } from '../departments/departments.module';
import { RoleAllocationController } from './role-allocation.controller';
import { RoleAllocationService } from './role-allocation.service';

@Module({
  imports: [PrismaModule, PrincipalDepartmentsModule],
  controllers: [RoleAllocationController],
  providers: [RoleAllocationService],
})
export class RoleAllocationModule {}
