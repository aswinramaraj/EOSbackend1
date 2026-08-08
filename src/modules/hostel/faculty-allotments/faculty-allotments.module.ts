import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyAllotmentsService } from './faculty-allotments.service';
import { FacultyAllotmentsController } from './faculty-allotments.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyAllotmentsController],
  providers: [FacultyAllotmentsService],
})
export class FacultyAllotmentsModule {}
