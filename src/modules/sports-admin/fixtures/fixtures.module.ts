import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { FixturesService } from './fixtures.service';
import { FixturesController } from './fixtures.controller';

@Module({
  imports: [PrismaModule],
  controllers: [FixturesController],
  providers: [FixturesService],
  exports: [FixturesService],
})
export class FixturesModule {}
