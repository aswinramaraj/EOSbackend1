import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PassBoardService } from './pass-board.service';
import { PassBoardController } from './pass-board.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PassBoardController],
  providers: [PassBoardService],
})
export class PassBoardModule {}
