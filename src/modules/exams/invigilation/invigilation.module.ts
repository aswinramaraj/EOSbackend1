import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { InvigilationService } from './invigilation.service';
import { InvigilationController } from './invigilation.controller';

@Module({
  imports: [PrismaModule],
  controllers: [InvigilationController],
  providers: [InvigilationService],
})
export class InvigilationModule {}
