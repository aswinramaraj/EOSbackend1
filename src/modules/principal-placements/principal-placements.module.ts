import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalPlacementsController } from './principal-placements.controller';
import { PrincipalPlacementsService } from './principal-placements.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalPlacementsController],
  providers: [PrincipalPlacementsService],
})
export class PrincipalPlacementsModule {}
