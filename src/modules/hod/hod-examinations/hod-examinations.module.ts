import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodExaminationsService } from './hod-examinations.service';
import { HodExaminationsController } from './hod-examinations.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodExaminationsController],
  providers: [HodExaminationsService],
})
export class HodExaminationsModule {}
