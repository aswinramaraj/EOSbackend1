import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { StudentTodosService } from './student-todos.service';
import { PlacementTodosController } from './placement-todos.controller';
import { MeTodosController } from './me-todos.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [PlacementTodosController, MeTodosController],
  providers: [StudentTodosService],
})
export class StudentTodosModule {}
