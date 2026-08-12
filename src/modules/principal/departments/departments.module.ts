import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalDepartmentsController } from './departments.controller';
import { PrincipalDepartmentsService } from './departments.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalDepartmentsController],
  providers: [PrincipalDepartmentsService],
})
export class PrincipalDepartmentsModule {}
