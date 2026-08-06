import { Module } from '@nestjs/common';
import { MalpracticeService } from './malpractice.service';
import { MalpracticeController } from './malpractice.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [MalpracticeController],
  providers: [MalpracticeService],
})
export class MalpracticeModule {}
