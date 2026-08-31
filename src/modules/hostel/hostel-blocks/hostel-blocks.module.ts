import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HostelBlocksService } from './hostel-blocks.service';
import { HostelBlocksController } from './hostel-blocks.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HostelBlocksController],
  providers: [HostelBlocksService],
  exports: [HostelBlocksService],
})
export class HostelBlocksModule {}
