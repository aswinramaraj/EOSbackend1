import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodNoDueService } from './hod-no-due.service';
import { HodNoDueController } from './hod-no-due.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodNoDueController],
  providers: [HodNoDueService],
})
export class HodNoDueModule {}
