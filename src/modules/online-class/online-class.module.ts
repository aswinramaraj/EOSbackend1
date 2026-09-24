import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OnlineClassService } from './online-class.service';
import { OnlineClassController } from './online-class.controller';

@Module({
  imports: [PrismaModule],
  controllers: [OnlineClassController],
  providers: [OnlineClassService],
})
export class OnlineClassModule {}
