import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SecretaryReportsController } from './reports.controller';
import { SecretaryReportsService } from './reports.service';

@Module({
  imports: [PrismaModule],
  controllers: [SecretaryReportsController],
  providers: [SecretaryReportsService],
})
export class SecretaryReportsModule {}
