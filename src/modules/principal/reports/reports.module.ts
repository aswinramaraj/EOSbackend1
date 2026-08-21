import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalReportsController } from './reports.controller';
import { PrincipalReportsService } from './reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalReportsController],
  providers: [PrincipalReportsService],
})
export class PrincipalReportsModule {}
