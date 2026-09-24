import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificationsModule } from 'src/modules/notifications/notifications/notifications.module';
import { WalletService } from './wallet.service';
import { WalletController } from './wallet.controller';

@Module({
  imports: [PrismaModule, NotificationsModule],
  controllers: [WalletController],
  providers: [WalletService],
  // StationeryModule reuses debitForPurchase for "pay with wallet" - see
  // that method's own doc comment. Also reused by CanteenOrderingModule for
  // the wallet debit/refund that pays for a food order - a purchase, not a
  // peer transfer, but the same lock-check-insert primitive belongs in one
  // place.
  exports: [WalletService],
})
export class WalletModule {}
