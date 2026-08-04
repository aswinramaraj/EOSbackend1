import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OutingsService } from './outings.service';
import { OutingsController } from './outings.controller';

@Module({
  imports: [PrismaModule],
  controllers: [OutingsController],
  providers: [OutingsService],
})
export class OutingsModule {}
