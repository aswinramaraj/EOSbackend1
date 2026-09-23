import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyHostelComplaintsController } from './faculty-hostel-complaints.controller';
import { FacultyHostelComplaintsService } from './faculty-hostel-complaints.service';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyHostelComplaintsController],
  providers: [FacultyHostelComplaintsService],
})
export class FacultyHostelComplaintsModule {}
