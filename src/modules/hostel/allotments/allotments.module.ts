import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AllotmentsService } from './allotments.service';
import { AllotmentsController } from './allotments.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AllotmentsController],
  providers: [AllotmentsService],
})
export class AllotmentsModule {}
