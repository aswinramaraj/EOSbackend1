import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalStudentsController } from './principal-students.controller';
import { PrincipalStudentsService } from './principal-students.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalStudentsController],
  providers: [PrincipalStudentsService],
})
export class PrincipalStudentsModule {}
