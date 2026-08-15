import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { OdService } from './od.service';
import { OdController } from './od.controller';

@Module({
  imports: [PrismaModule],
  controllers: [OdController],
  providers: [OdService],
  exports: [OdService],
})
export class OdModule {}
