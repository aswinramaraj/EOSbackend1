import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { LibrarySettingsModule } from 'src/modules/library/settings/settings.module';
import { NoDueService } from './no-due.service';
import { NoDueController } from './no-due.controller';

@Module({
  imports: [PrismaModule, LibrarySettingsModule],
  controllers: [NoDueController],
  providers: [NoDueService],
})
export class NoDueModule {}
