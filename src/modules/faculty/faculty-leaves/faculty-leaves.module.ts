import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyLeavesService } from './faculty-leaves.service';
import { FacultyLeavesController } from './faculty-leaves.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyLeavesController],
  providers: [FacultyLeavesService],
  exports: [FacultyLeavesService],
})
export class FacultyLeavesModule {}
