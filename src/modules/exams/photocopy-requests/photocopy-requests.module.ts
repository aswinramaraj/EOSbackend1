import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PhotocopyRequestsService } from './photocopy-requests.service';
import { PhotocopyRequestsController } from './photocopy-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [PhotocopyRequestsController],
  providers: [PhotocopyRequestsService],
})
export class PhotocopyRequestsModule {}
