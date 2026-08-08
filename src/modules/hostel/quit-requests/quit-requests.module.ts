import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { QuitRequestsService } from './quit-requests.service';
import { QuitRequestsController } from './quit-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [QuitRequestsController],
  providers: [QuitRequestsService],
})
export class QuitRequestsModule {}
