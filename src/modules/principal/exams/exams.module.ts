import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalExamsController } from './exams.controller';
import { PrincipalExamsService } from './exams.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalExamsController],
  providers: [PrincipalExamsService],
})
export class PrincipalExamsModule {}
