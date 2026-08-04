import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { GateLogService } from './gate-log.service';
import { GateLogController } from './gate-log.controller';

@Module({
  imports: [PrismaModule],
  controllers: [GateLogController],
  providers: [GateLogService],
})
export class GateLogModule {}
