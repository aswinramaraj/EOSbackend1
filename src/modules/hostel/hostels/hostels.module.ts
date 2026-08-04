import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HostelsService } from './hostels.service';
import { HostelsController } from './hostels.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HostelsController],
  providers: [HostelsService],
  exports: [HostelsService],
})
export class HostelsModule {}
