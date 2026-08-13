import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentLeavesService } from './student-leaves.service';
import { StudentLeavesController } from './student-leaves.controller';

@Module({
  imports: [PrismaModule],
  controllers: [StudentLeavesController],
  providers: [StudentLeavesService],
  exports: [StudentLeavesService],
})
export class StudentLeavesModule {}
