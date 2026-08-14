import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyOdRequestsService } from './faculty-od-requests.service';
import { FacultyOdRequestsController } from './faculty-od-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyOdRequestsController],
  providers: [FacultyOdRequestsService],
})
export class FacultyOdRequestsModule {}
