import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { EdcEventsController } from './edc-events.controller';
import { EdcEventsService } from './edc-events.service';

@Module({
  imports: [PrismaModule],
  controllers: [EdcEventsController],
  providers: [EdcEventsService],
})
export class EdcEventsModule {}
