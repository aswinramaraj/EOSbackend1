import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { GoodsService } from './goods.service';
import { GoodsController } from './goods.controller';

@Module({
  imports: [PrismaModule],
  controllers: [GoodsController],
  providers: [GoodsService],
})
export class GoodsModule {}
