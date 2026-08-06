import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { BonafideReasonsService } from './bonafide-reasons.service';
import { BonafideReasonsController } from './bonafide-reasons.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BonafideReasonsController],
  providers: [BonafideReasonsService],
})
export class BonafideReasonsModule {}
