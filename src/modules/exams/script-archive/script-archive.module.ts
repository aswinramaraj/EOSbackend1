import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ScriptArchiveService } from './script-archive.service';
import { ScriptArchiveController } from './script-archive.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ScriptArchiveController],
  providers: [ScriptArchiveService],
})
export class ScriptArchiveModule {}
