import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { EdcFundingController } from './edc-funding.controller';
import { EdcFundingService } from './edc-funding.service';

@Module({
  imports: [PrismaModule],
  controllers: [EdcFundingController],
  providers: [EdcFundingService],
})
export class EdcFundingModule {}
