import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { JwtPayload } from '../interfaces/jwt-payload.interface';

/**
 * Must be used AFTER JwtAuthGuard + RolesGuard so that request.user is
 * populated and the caller is already confirmed to be a `coe` user.
 *
 * Usage:
 *   @Roles(ROLES.COE)
 *   @UseGuards(JwtAuthGuard, RolesGuard, SeniorCoeGuard)
 *   publish() { ... }
 */
@Injectable()
export class SeniorCoeGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<{ user: JwtPayload }>();

    if (!user?.isSeniorCoe) {
      throw new ForbiddenException({
        message:
          'This action requires Senior Controller of Examinations access.',
        errorCode: 'SENIOR_COE_REQUIRED',
      });
    }

    return true;
  }
}
