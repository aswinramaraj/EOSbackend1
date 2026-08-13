import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodEdcService } from './hod-edc.service';
import { HodEdcController } from './hod-edc.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodEdcController],
  providers: [HodEdcService],
})
export class HodEdcModule {}
