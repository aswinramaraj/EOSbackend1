import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalPlacementsController } from './placements.controller';
import { PrincipalPlacementsService } from './placements.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalPlacementsController],
  providers: [PrincipalPlacementsService],
})
export class PrincipalPlacementsModule {}
