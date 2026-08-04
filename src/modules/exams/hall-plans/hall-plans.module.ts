import { Module } from '@nestjs/common';
import { HallPlansService } from './hall-plans.service';
import { HallPlansController } from './hall-plans.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [HallPlansController],
  providers: [HallPlansService],
})
export class HallPlansModule {}
