import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UpdateCoeProfileDto } from './dto/update-coe-profile.dto';

@Injectable()
export class CoeProfilesService {
  private readonly logger = new Logger(CoeProfilesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Every `coe`-role user, with their senior-tier flag (false if no profile row exists yet). */
  async findAll() {
    try {
      const users = await this.prisma.users.findMany({
        where: { roles: { name: 'coe' } },
        select: {
          id: true,
          email: true,
          status: true,
          coe_profiles: { select: { is_senior: true } },
        },
      });

      return users.map((u) => ({
        user_id: u.id,
        email: u.email,
        status: u.status,
        is_senior: u.coe_profiles?.is_senior ?? false,
      }));
    } catch (err) {
      this.logger.error('DB error while fetching COE profiles', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }

  async update(userId: number, dto: UpdateCoeProfileDto) {
    const user = await this.prisma.users.findUnique({
      where: { id: userId },
      include: { roles: true },
    });

    if (!user) {
      throw new NotFoundException({
        message: 'User not found.',
        errorCode: 'USER_NOT_FOUND',
      });
    }

    if (user.roles.name !== 'coe') {
      throw new BadRequestException({
        message: 'User is not a Controller of Examinations.',
        errorCode: 'NOT_COE_USER',
      });
    }

    try {
      const profile = await this.prisma.coe_profiles.upsert({
        where: { user_id: userId },
        create: { user_id: userId, is_senior: dto.is_senior },
        update: { is_senior: dto.is_senior },
      });

      return {
        user_id: userId,
        email: user.email,
        is_senior: profile.is_senior,
      };
    } catch (err) {
      this.logger.error('DB error while updating COE profile', err);
      throw new InternalServerErrorException({
        message: 'Something went wrong. Please try again.',
        errorCode: 'INTERNAL_ERROR',
      });
    }
  }
}
