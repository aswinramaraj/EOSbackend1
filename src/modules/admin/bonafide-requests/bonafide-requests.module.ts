import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { BonafideRequestsService } from './bonafide-requests.service';
import { BonafideRequestsController } from './bonafide-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BonafideRequestsController],
  providers: [BonafideRequestsService],
})
export class BonafideRequestsModule {}
