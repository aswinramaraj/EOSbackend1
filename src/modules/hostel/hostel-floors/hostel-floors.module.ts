import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HostelFloorsService } from './hostel-floors.service';
import { HostelFloorsController } from './hostel-floors.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HostelFloorsController],
  providers: [HostelFloorsService],
  exports: [HostelFloorsService],
})
export class HostelFloorsModule {}
