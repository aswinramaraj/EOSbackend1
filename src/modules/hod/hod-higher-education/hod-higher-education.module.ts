import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodHigherEducationService } from './hod-higher-education.service';
import { HodHigherEducationController } from './hod-higher-education.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodHigherEducationController],
  providers: [HodHigherEducationService],
})
export class HodHigherEducationModule {}
