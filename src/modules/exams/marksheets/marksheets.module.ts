import { Module } from '@nestjs/common';
import { MarksheetsService } from './marksheets.service';
import { MarksheetsController } from './marksheets.controller';
import { MeMarksheetsController } from './me-marksheets.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MarksheetsController, MeMarksheetsController],
  providers: [MarksheetsService],
})
export class MarksheetsModule {}
