import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalTransportController } from './transport.controller';
import { PrincipalTransportService } from './transport.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalTransportController],
  providers: [PrincipalTransportService],
})
export class PrincipalTransportModule {}
