import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalFacultyController } from './principal-faculty.controller';
import { PrincipalFacultyService } from './principal-faculty.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalFacultyController],
  providers: [PrincipalFacultyService],
})
export class PrincipalFacultyModule {}
