import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HrRequestsService } from './hr-requests.service';
import { HrRequestsController } from './hr-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HrRequestsController],
  providers: [HrRequestsService],
  exports: [HrRequestsService],
})
export class HrRequestsModule {}
