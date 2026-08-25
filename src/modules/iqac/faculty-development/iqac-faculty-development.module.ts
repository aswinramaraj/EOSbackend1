import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalFacultyModule } from 'src/modules/principal/faculty/faculty.module';
import { IqacFacultyDevelopmentController } from './iqac-faculty-development.controller';
import { IqacFacultyDevelopmentService } from './iqac-faculty-development.service';

@Module({
  imports: [PrismaModule, PrincipalFacultyModule],
  controllers: [IqacFacultyDevelopmentController],
  providers: [IqacFacultyDevelopmentService],
  exports: [IqacFacultyDevelopmentService],
})
export class IqacFacultyDevelopmentModule {}
