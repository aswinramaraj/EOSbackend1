import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  imports: [PrismaModule],
  controllers: [WalletController],
  providers: [WalletService],
})
export class WalletModule {}
