import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HostelFeesService } from './fees.service';
import { HostelFeesController } from './fees.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HostelFeesController],
  providers: [HostelFeesService],
})
export class HostelFeesModule {}
