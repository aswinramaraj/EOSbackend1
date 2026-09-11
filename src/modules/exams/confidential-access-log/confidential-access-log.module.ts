import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConfidentialAccessLogService } from './confidential-access-log.service';
import { ConfidentialAccessLogController } from './confidential-access-log.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ConfidentialAccessLogController],
  providers: [ConfidentialAccessLogService],
})
export class ConfidentialAccessLogModule {}
