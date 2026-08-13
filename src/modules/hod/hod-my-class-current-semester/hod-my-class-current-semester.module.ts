import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { HodMyClassCurrentSemesterService } from './hod-my-class-current-semester.service';
import { HodMyClassCurrentSemesterController } from './hod-my-class-current-semester.controller';

@Module({
  imports: [PrismaModule],
  controllers: [HodMyClassCurrentSemesterController],
  providers: [HodMyClassCurrentSemesterService],
})
export class HodMyClassCurrentSemesterModule {}
