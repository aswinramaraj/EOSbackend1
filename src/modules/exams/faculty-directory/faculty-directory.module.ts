import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FacultyDirectoryService } from './faculty-directory.service';
import { FacultyDirectoryController } from './faculty-directory.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FacultyDirectoryController],
  providers: [FacultyDirectoryService],
})
export class FacultyDirectoryModule {}
