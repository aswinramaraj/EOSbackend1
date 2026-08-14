import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HrDepartmentsService } from './hr-departments.service';
import { HrDepartmentsController } from './hr-departments.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HrDepartmentsController],
  providers: [HrDepartmentsService],
  exports: [HrDepartmentsService],
})
export class HrDepartmentsModule {}
