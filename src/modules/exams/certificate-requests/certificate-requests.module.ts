import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { CertificateRequestsService } from './certificate-requests.service';
import { CertificateRequestsController } from './certificate-requests.controller';

@Module({
  imports: [PrismaModule],
  controllers: [CertificateRequestsController],
  providers: [CertificateRequestsService],
})
export class CertificateRequestsModule {}
