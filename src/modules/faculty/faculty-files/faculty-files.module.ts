import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/modules/storage/storage.module';
import { FacultyFilesService } from './faculty-files.service';
import { FacultyFilesController } from './faculty-files.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [FacultyFilesController],
  providers: [FacultyFilesService],
})
export class FacultyFilesModule {}
