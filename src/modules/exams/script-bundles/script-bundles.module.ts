import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ScriptBundlesService } from './script-bundles.service';
import { ScriptBundlesController } from './script-bundles.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ScriptBundlesController],
  providers: [ScriptBundlesService],
})
export class ScriptBundlesModule {}
