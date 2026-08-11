import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import crypto from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { PrismaService } from 'src/prisma/prisma.service';
import type { LoginDto } from './dto/login.dto';
import type { JwtPayload } from './interfaces/jwt-payload.interface';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * POST /auth/login
   *
   * Error cases:
   *  401 INVALID_CREDENTIALS  – email not found OR password wrong (same message intentionally)
   *  403 ACCOUNT_INACTIVE     – correct credentials but user is deactivated
   *  500 INTERNAL_ERROR       – unexpected failure (DB, JWT, etc.)
   */
  async login(dto: LoginDto) {
    let user: any;

    try {
      user = await (this.prisma as any).users.findUnique({
        where: { email: dto.email },
        include: { roles: true },
      });
    } catch (err) {
      this.logger.error('DB error during login lookup', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    // ── 401: user not found ──────────────────────────────────────────────────
    if (!user) {
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        errorCode: 'INVALID_CREDENTIALS',
      });
    }

    // ── 403: account inactive ────────────────────────────────────────────────
    if (user.status !== 'active') {
      throw new ForbiddenException({
        message: 'Account is inactive. Contact administrator.',
        errorCode: 'ACCOUNT_INACTIVE',
      });
    }

    // ── 401: wrong password ──────────────────────────────────────────────────
    const hash = crypto.createHash('sha256').update(dto.password).digest('hex');
    if (hash !== user.password_hash) {
      throw new UnauthorizedException({
        message: 'Invalid email or password',
        errorCode: 'INVALID_CREDENTIALS',
      });
    }

    // ── Sign JWT ─────────────────────────────────────────────────────────────
    let accessToken: string;
    try {
      const payload: JwtPayload = {
        sub: user.id,
        email: user.email,
        role: user.roles.name,
        roleId: user.roles.id,
      };

      const secret = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION';
      const expiresIn = process.env.JWT_EXPIRES_IN || '8h';
      accessToken = jwt.sign(payload, secret, { expiresIn } as any);
    } catch (err) {
      this.logger.error('JWT signing failed', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }

    this.logger.log(`✅ ${user.email} (role: ${user.roles.name}) logged in`);

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.roles.name,
        roleId: user.roles.id,
      },
    };
  }

  /**
   * GET /auth/me
   * Returns the authenticated user's basic profile, plus a resolved `name`
   * (see resolveDisplayName) for anywhere the app wants to greet the user
   * by their real name instead of deriving something off their email.
   */
  async getMe(userId: number) {
    const user = await (this.prisma as any).users.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        status: true,
        created_at: true,
        roles: { select: { id: true, name: true, description: true } },
        faculty: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            designation: true,
            departments: { select: { id: true, name: true, code: true } },
          },
        },
        students: {
          select: {
            id: true,
            student_id_no: true,
            roll_no: true,
            register_no: true,
            student_type: true,
            status: true,
            soa_applications: { select: { first_name: true, last_name: true } },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException({
        message: 'User not found',
        errorCode: 'INVALID_CREDENTIALS',
      });
    }

    return { ...user, name: this.resolveDisplayName(user) };
  }

  /**
   * Faculty/HoD -> their own first_name/last_name columns. Student -> their
   * soa_applications name if one was ever filed, same convention already
   * used for achievement-comment authorship (see AchievementsService.
   * toCommenterDisplay) - no soa_applications row, or no profile at all
   * (Parent, HR, Finance, ...), falls back to the account's email, since
   * neither has a real name stored anywhere else in the schema.
   */
  private resolveDisplayName(user: {
    email: string;
    faculty: { first_name: string; last_name: string } | null;
    students: { soa_applications: { first_name: string; last_name: string | null } | null } | null;
  }): string {
    if (user.faculty) {
      return `${user.faculty.first_name} ${user.faculty.last_name}`;
    }
    if (user.students?.soa_applications) {
      const { first_name, last_name } = user.students.soa_applications;
      return last_name ? `${first_name} ${last_name}` : first_name;
    }
    return user.email;
  }
}
