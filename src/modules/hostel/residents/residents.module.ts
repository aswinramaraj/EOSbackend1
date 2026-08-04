import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ResidentsService } from './residents.service';
import { ResidentsController } from './residents.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ResidentsController],
  providers: [ResidentsService],
})
export class ResidentsModule {}
