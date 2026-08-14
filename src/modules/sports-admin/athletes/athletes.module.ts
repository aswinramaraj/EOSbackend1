import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AthletesService } from './athletes.service';
import { AthletesController } from './athletes.controller';

@Module({
  imports: [PrismaModule],
  controllers: [AthletesController],
  providers: [AthletesService],
  exports: [AthletesService],
})
export class AthletesModule {}
