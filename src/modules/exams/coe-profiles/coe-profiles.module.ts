import { Module } from '@nestjs/common';
import { CoeProfilesService } from './coe-profiles.service';
import { CoeProfilesController } from './coe-profiles.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [CoeProfilesController],
  providers: [CoeProfilesService],
})
export class CoeProfilesModule {}
