import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { StudentsService } from './students.service';
import { StudentsController } from './students.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [StudentsController],
  providers: [StudentsService],
})
export class StudentsModule {}
