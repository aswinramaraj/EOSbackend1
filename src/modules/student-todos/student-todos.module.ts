import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StudentTodosService } from './student-todos.service';
import { PlacementTodosController } from './placement-todos.controller';
import { MeTodosController } from './me-todos.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PlacementTodosController, MeTodosController],
  providers: [StudentTodosService],
})
export class StudentTodosModule {}
