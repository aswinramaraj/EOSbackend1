import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { DisciplinesService } from './disciplines.service';
import { DisciplinesController } from './disciplines.controller';

@Module({
  imports: [PrismaModule],
  controllers: [DisciplinesController],
  providers: [DisciplinesService],
  exports: [DisciplinesService],
})
export class DisciplinesModule {}
