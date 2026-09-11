import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { QuestionPapersService } from './question-papers.service';
import { QuestionPapersController } from './question-papers.controller';

@Module({
  imports: [PrismaModule],
  controllers: [QuestionPapersController],
  providers: [QuestionPapersService],
})
export class QuestionPapersModule {}
