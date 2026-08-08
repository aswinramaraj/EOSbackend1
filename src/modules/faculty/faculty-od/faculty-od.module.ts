import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyOdService } from './faculty-od.service';
import { FacultyOdController } from './faculty-od.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyOdController],
  providers: [FacultyOdService],
})
export class FacultyOdModule {}
