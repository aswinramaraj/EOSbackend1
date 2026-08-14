import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalExamsController } from './principal-exams.controller';
import { PrincipalExamsService } from './principal-exams.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalExamsController],
  providers: [PrincipalExamsService],
})
export class PrincipalExamsModule {}
