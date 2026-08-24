import {
  Controller,
  Post,
  Body,
  Get,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * POST /api/v1/auth/login
   *
   * Rate limit: 5 attempts per 60 seconds per IP (stricter than global 100/60s).
   * On breach → 429 RATE_LIMIT_EXCEEDED.
   *
   * Error responses:
   *  400 VALIDATION_ERROR   – missing/invalid email or password field
   *  401 INVALID_CREDENTIALS – wrong email or wrong password (same message)
   *  403 ACCOUNT_INACTIVE   – correct credentials but account deactivated
   *  429 RATE_LIMIT_EXCEEDED – too many attempts
   *  500 INTERNAL_ERROR     – unexpected server failure
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  /**
   * GET /api/v1/auth/me
   * Returns the authenticated user's profile.
   * Rate limit: inherits global (100/60s) — no brute-force risk here.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  getMe(@CurrentUser() user: JwtPayload) {
    return this.authService.getMe(user.sub);
  }

  /**
   * GET /api/v1/auth/roles
   * Every role the caller can switch into (currently always just their
   * own — see AuthService.getRoles for why).
   */
  @Get('roles')
  @UseGuards(JwtAuthGuard)
  @SkipThrottle()
  getRoles(@CurrentUser() user: JwtPayload) {
    return this.authService.getRoles(user.sub);
  }
}
