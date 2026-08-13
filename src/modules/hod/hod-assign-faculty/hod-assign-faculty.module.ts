import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodAssignFacultyService } from './hod-assign-faculty.service';
import { HodAssignFacultyController } from './hod-assign-faculty.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodAssignFacultyController],
  providers: [HodAssignFacultyService],
})
export class HodAssignFacultyModule {}
