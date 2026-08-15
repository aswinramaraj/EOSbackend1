import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { SportsAdminMeService } from './me.service';
import { SportsAdminMeController } from './me.controller';

@Module({
  imports: [PrismaModule],
  controllers: [SportsAdminMeController],
  providers: [SportsAdminMeService],
  exports: [SportsAdminMeService],
})
export class SportsAdminMeModule {}
