import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CoeBroadcastsService } from './coe-broadcasts.service';
import { CoeBroadcastsController } from './coe-broadcasts.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CoeBroadcastsController],
  providers: [CoeBroadcastsService],
})
export class CoeBroadcastsModule {}
