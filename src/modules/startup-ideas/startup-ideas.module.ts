import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { StartupIdeasController } from './startup-ideas.controller';
import { StartupIdeasService } from './startup-ideas.service';

@Module({
  imports: [PrismaModule],
  controllers: [StartupIdeasController],
  providers: [StartupIdeasService],
})
export class StartupIdeasModule {}
