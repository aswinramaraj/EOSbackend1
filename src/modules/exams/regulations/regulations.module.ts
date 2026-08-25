import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RegulationsService } from './regulations.service';
import { RegulationsController } from './regulations.controller';

@Module({
  imports: [PrismaModule],
  controllers: [RegulationsController],
  providers: [RegulationsService],
})
export class RegulationsModule {}
