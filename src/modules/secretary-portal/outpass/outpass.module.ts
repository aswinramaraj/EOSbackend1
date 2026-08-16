import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OutpassController } from './outpass.controller';
import { OutpassService } from './outpass.service';

@Module({
  imports: [PrismaModule],
  controllers: [OutpassController],
  providers: [OutpassService],
})
export class OutpassModule {}
