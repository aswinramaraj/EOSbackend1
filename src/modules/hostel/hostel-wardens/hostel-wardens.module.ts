import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HostelWardensService } from './hostel-wardens.service';
import { HostelWardensController } from './hostel-wardens.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HostelWardensController],
  providers: [HostelWardensService],
  exports: [HostelWardensService],
})
export class HostelWardensModule {}
