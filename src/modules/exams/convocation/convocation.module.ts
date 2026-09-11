import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ConvocationService } from './convocation.service';
import { ConvocationController } from './convocation.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ConvocationController],
  providers: [ConvocationService],
})
export class ConvocationModule {}
