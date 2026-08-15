import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalSportsController } from './principal-sports.controller';
import { PrincipalSportsService } from './principal-sports.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalSportsController],
  providers: [PrincipalSportsService],
})
export class PrincipalSportsModule {}
