import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { CurrentUser } from 'src/auth/decorators/current-user.decorator';
import type { JwtPayload } from 'src/auth/interfaces/jwt-payload.interface';
import { ROLES } from 'src/common/constants/roles.constant';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { WalletService } from './wallet.service';
import { SetPinDto } from './dto/set-pin.dto';
import { ChangePinDto } from './dto/change-pin.dto';
import { CreateTopupOrderDto } from './dto/create-topup-order.dto';
import { VerifyTopupDto } from './dto/verify-topup.dto';
import { TransferFundsDto } from './dto/transfer-funds.dto';

// Every role gets a wallet except Parent ("except parent login, all must
// have the wallet access") - computed from ROLES rather than hand-listing
// every other role, so a newly added role is automatically included
// without this file needing to change too.
const WALLET_ROLES = Object.values(ROLES).filter((role) => role !== ROLES.PARENT);

/**
 * The Wallet feature - top-up via Razorpay plus GPay-style QR-to-QR
 * transfers between wallets. Every route here is self-scoped to the
 * caller's own wallet (auto-provisioned on first touch, see
 * WalletService.findOrCreateWallet), there is no "view someone else's
 * wallet" endpoint at all.
 */
@Controller('me/wallet')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(...WALLET_ROLES)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  getWallet(@CurrentUser() user: JwtPayload) {
    return this.walletService.getWallet(user.sub);
  }

  @Get('transactions')
  getTransactions(@CurrentUser() user: JwtPayload, @Query() query: PaginationDto) {
    return this.walletService.getTransactions(user.sub, query);
  }

  @Post('pin')
  setPin(@CurrentUser() user: JwtPayload, @Body() dto: SetPinDto) {
    return this.walletService.setPin(user.sub, dto);
  }

  @Patch('pin')
  changePin(@CurrentUser() user: JwtPayload, @Body() dto: ChangePinDto) {
    return this.walletService.changePin(user.sub, dto);
  }

  @Get('resolve/:qrToken')
  resolveByQrToken(@CurrentUser() user: JwtPayload, @Param('qrToken') qrToken: string) {
    return this.walletService.resolveByQrToken(user.sub, qrToken);
  }

  @Post('transfer')
  transfer(@CurrentUser() user: JwtPayload, @Body() dto: TransferFundsDto) {
    return this.walletService.transfer(user.sub, dto);
  }

  @Post('topup/order')
  createTopupOrder(@CurrentUser() user: JwtPayload, @Body() dto: CreateTopupOrderDto) {
    return this.walletService.createTopupOrder(user.sub, dto);
  }

  @Post('topup/verify')
  verifyTopup(@CurrentUser() user: JwtPayload, @Body() dto: VerifyTopupDto) {
    return this.walletService.verifyTopup(user.sub, dto);
  }
}
