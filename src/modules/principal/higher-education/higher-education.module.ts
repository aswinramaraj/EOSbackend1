import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalHigherEducationController } from './higher-education.controller';
import { PrincipalHigherEducationService } from './higher-education.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalHigherEducationController],
  providers: [PrincipalHigherEducationService],
})
export class PrincipalHigherEducationModule {}
