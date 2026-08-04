import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HostelSettingsService } from './settings.service';
import { HostelSettingsController } from './settings.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HostelSettingsController],
  providers: [HostelSettingsService],
  exports: [HostelSettingsService],
})
export class HostelSettingsModule {}
