import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { EdcDocumentsController } from './edc-documents.controller';
import { EdcDocumentsService } from './edc-documents.service';

@Module({
  imports: [PrismaModule],
  controllers: [EdcDocumentsController],
  providers: [EdcDocumentsService],
})
export class EdcDocumentsModule {}
