import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AccreditationController } from './accreditation.controller';
import { AccreditationService } from './accreditation.service';

@Module({
  imports: [PrismaModule],
  controllers: [AccreditationController],
  providers: [AccreditationService],
})
export class AccreditationModule {}
