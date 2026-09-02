import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SubjectNoDueService } from './subject-no-due.service';
import { SubjectNoDueController } from './subject-no-due.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SubjectNoDueController],
  providers: [SubjectNoDueService],
  exports: [SubjectNoDueService],
})
export class SubjectNoDueModule {}
