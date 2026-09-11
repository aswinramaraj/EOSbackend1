import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StorageModule } from 'src/common/storage/storage.module';
import { ScriptArchiveService } from './script-archive.service';
import { ScriptArchiveController } from './script-archive.controller';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [ScriptArchiveController],
  providers: [ScriptArchiveService],
})
export class ScriptArchiveModule {}
