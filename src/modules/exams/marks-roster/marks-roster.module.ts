import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MarksRosterService } from './marks-roster.service';
import { MarksRosterController } from './marks-roster.controller';

@Module({
  imports: [PrismaModule],
  controllers: [MarksRosterController],
  providers: [MarksRosterService],
})
export class MarksRosterModule {}
