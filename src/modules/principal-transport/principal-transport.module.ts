import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalTransportController } from './principal-transport.controller';
import { PrincipalTransportService } from './principal-transport.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalTransportController],
  providers: [PrincipalTransportService],
})
export class PrincipalTransportModule {}
