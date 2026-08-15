import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { InjuriesService } from './injuries.service';
import { InjuriesController } from './injuries.controller';

@Module({
  imports: [PrismaModule],
  controllers: [InjuriesController],
  providers: [InjuriesService],
  exports: [InjuriesService],
})
export class InjuriesModule {}
