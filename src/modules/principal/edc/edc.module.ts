import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrincipalEdcController } from './edc.controller';
import { PrincipalEdcService } from './edc.service';

@Module({
  imports: [PrismaModule],
  controllers: [PrincipalEdcController],
  providers: [PrincipalEdcService],
  exports: [PrincipalEdcService],
})
export class PrincipalEdcModule {}
