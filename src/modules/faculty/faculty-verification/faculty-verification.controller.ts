import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { ROLES } from 'src/common/constants/roles.constant';
import { FacultyVerificationService } from './faculty-verification.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

/**
 * Admin-only Twilio Verify integration for the faculty Contact Information
 * screens (phone + WhatsApp number "Verify" buttons). No database access —
 * this is a pure passthrough to Twilio; the OTP itself, its expiry, and its
 * attempt count all live entirely on Twilio's side.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(ROLES.ADMIN)
@Controller('me/faculty-verification')
export class FacultyVerificationController {
  constructor(private readonly verificationService: FacultyVerificationService) {}

  @Post('send')
  send(@Body() dto: SendOtpDto) {
    return this.verificationService.sendOtp(dto.phone, dto.channel);
  }

  @Post('check')
  check(@Body() dto: VerifyOtpDto) {
    return this.verificationService.checkOtp(dto.phone, dto.code);
  }
}
