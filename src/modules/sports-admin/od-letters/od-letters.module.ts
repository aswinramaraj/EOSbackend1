import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OdLettersService } from './od-letters.service';
import { OdLettersController } from './od-letters.controller';

@Module({
  imports: [PrismaModule],
  controllers: [OdLettersController],
  providers: [OdLettersService],
})
export class OdLettersModule {}
