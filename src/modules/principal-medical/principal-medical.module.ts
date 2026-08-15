import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalMedicalController } from './principal-medical.controller';
import { PrincipalMedicalService } from './principal-medical.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalMedicalController],
  providers: [PrincipalMedicalService],
})
export class PrincipalMedicalModule {}
