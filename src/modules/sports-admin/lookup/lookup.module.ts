import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SportsLookupService } from './lookup.service';
import { SportsLookupController } from './lookup.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SportsLookupController],
  providers: [SportsLookupService],
  exports: [SportsLookupService],
})
export class SportsLookupModule {}
