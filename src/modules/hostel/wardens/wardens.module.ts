import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WardensService } from './wardens.service';
import { WardensController } from './wardens.controller';

@Module({
  imports: [PrismaModule],
  controllers: [WardensController],
  providers: [WardensService],
  exports: [WardensService],
})
export class WardensModule {}
