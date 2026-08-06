import { Module } from '@nestjs/common';
import { MarksEntryLocksService } from './marks-entry-locks.service';
import { MarksEntryLocksController } from './marks-entry-locks.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MarksEntryLocksController],
  providers: [MarksEntryLocksService],
})
export class MarksEntryLocksModule {}
