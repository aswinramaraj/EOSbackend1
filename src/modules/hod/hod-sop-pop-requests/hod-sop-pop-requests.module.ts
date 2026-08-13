import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodSopPopRequestsService } from './hod-sop-pop-requests.service';
import { HodSopPopRequestsController } from './hod-sop-pop-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodSopPopRequestsController],
  providers: [HodSopPopRequestsService],
})
export class HodSopPopRequestsModule {}
