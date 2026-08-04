import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ComplaintsService } from './complaints.service';
import { ComplaintsController } from './complaints.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ComplaintsController],
  providers: [ComplaintsService],
})
export class ComplaintsModule {}
