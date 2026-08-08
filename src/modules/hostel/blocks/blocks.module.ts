import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { BlocksService } from './blocks.service';
import { BlocksController } from './blocks.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BlocksController],
  providers: [BlocksService],
  exports: [BlocksService],
})
export class BlocksModule {}
