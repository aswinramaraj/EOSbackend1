import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { ArrearsService } from './arrears.service';
import { ArrearsController } from './arrears.controller';

@Module({
  imports: [PrismaModule],
  controllers: [ArrearsController],
  providers: [ArrearsService],
})
export class ArrearsModule {}
