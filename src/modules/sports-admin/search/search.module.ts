import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SportsSearchService } from './search.service';
import { SportsSearchController } from './search.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SportsSearchController],
  providers: [SportsSearchService],
  exports: [SportsSearchService],
})
export class SportsSearchModule {}
