import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CampusOutingRequestsService } from './campus-outing-requests.service';
import { CampusOutingRequestsController } from './campus-outing-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CampusOutingRequestsController],
  providers: [CampusOutingRequestsService],
})
export class CampusOutingRequestsModule {}
