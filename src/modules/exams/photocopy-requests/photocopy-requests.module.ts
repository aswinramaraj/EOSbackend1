import { Module } from '@nestjs/common';
import { PhotocopyRequestsService } from './photocopy-requests.service';
import { PhotocopyRequestsController } from './photocopy-requests.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PhotocopyRequestsController],
  providers: [PhotocopyRequestsService],
})
export class PhotocopyRequestsModule {}
