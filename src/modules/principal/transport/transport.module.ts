import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { TransportModule } from 'src/modules/transport/transport.module';
import { PrincipalTransportController } from './transport.controller';
import { PrincipalTransportService } from './transport.service';

@Module({
  imports: [PrismaModule, TransportModule],
  controllers: [PrincipalTransportController],
  providers: [PrincipalTransportService],
})
export class PrincipalTransportModule {}
